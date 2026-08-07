import { type DynamicToolCall, type ToolResultPart } from "ai"
import type { ToolResult } from "../tools/types"
import { globalToolRegistry } from "../tools/registry"
import { devLogger } from "./dev-logger"
import { SubagentManager } from "./subagent"
import type { ToolCallEvent } from "./intelligence"
import type { ExecuteContext, MessageContent } from "./phases/execute/context"

export interface ToolBatchResult {
  results: ToolResultPart[]
  events: ToolCallEvent[]
}

/**
 * v2 §4.M5 集成：返回 events 给 caller 调 afterExecute。
 * 这里不直接调 recorder，因为 executeToolBatch 是纯函数（v2 §2.5），
 * 让 caller 决定何时 record（一次 / 分批 / 失败回滚）。
 */
export async function executeToolBatch(
  toolCalls: DynamicToolCall[],
  msgs: Array<{ role: string; content: MessageContent[] }>,
  subagentManager: SubagentManager,
  subagentSystem: string,
  ctx: ExecuteContext,
): Promise<ToolBatchResult> {
  devLogger.info('PARALLEL', `Executing ${toolCalls.length} tool(s)`)
  const toolBatch = msgs.filter(m => m.role === 'tool').length + 1

  const results = await Promise.all(toolCalls.map(async (tc): Promise<{ result: ToolResultPart; event: ToolCallEvent }> => {
    devLogger.logToolCall(tc.toolName, tc.input)
    const tcInput = tc.input as Record<string, unknown>
    ctx.onToolCall?.(tc.toolName, tcInput, toolBatch)
    const toolId = ctx.timer?.start(`tool.${tc.toolName}`)
    const startTime = Date.now()
    let execResult: ToolResult | undefined
    let errorMessage: string | undefined

    if (tc.toolName === "subagent") {
      const subagentId = `sa_${Date.now()}`
      ctx.onSubagentStart?.(subagentId, tcInput.task as string)
      const subResult = await subagentManager.spawn(
        { task: tcInput.task as string, tools: tcInput.tools as string[] | undefined, timeoutMs: tcInput.timeoutMs as number | undefined },
        {
          model: ctx.model,
          system: subagentSystem,
          // subagent 内部只传 user + assistant（filter tool 消息避免 context 爆炸）
          // 同时清理 assistant.content 里的 tool-call parts —— AI SDK v6 看到 orphan tool-call
          // 会抛 "Tool result is missing" 错误（之前 commit 5846d81 修复的"重复执行"没修这个）
          messages: msgs
            .filter(m => m.role === "user" || m.role === "assistant")
            .map(m => {
              if (m.role === "assistant" && Array.isArray(m.content)) {
                return { ...m, content: m.content.filter((p: any) => p.type !== "tool-call") }
              }
              return m
            }),
          cwd: ctx.cwd ?? process.cwd(),
        },
      )
      // SubagentResult 字段是 text/error/durationMs，不是 ToolResult.output
      // 显式适配成 ToolResult 形状，让下游读 execResult.output 拿到真实输出
      execResult = {
        success: subResult.success,
        output: subResult.text,
        error: subResult.error,
      }
      ctx.onSubagentEnd?.(subagentId, execResult.success)
    } else {
      try {
        execResult = await globalToolRegistry.execute(tc.toolName, tcInput, { cwd: ctx.cwd })
      } catch (toolError: any) {
        execResult = { success: false, error: `工具执行异常: ${toolError?.message ?? toolError}` }
        errorMessage = toolError?.message ?? String(toolError)
      }
    }

    const durationMs = Date.now() - startTime
    const success = execResult?.success ?? false
    const timeout = execResult?.error?.toLowerCase().includes('timeout') ?? false
    const event: ToolCallEvent = {
      tool: tc.toolName,
      success,
      durationMs,
      timeout,
      ...(errorMessage ? { errorMessage } : {}),
    }

    devLogger.logToolCall(tc.toolName, tc.input, execResult)
    if (toolId) ctx.timer?.end(toolId, { success })
    ctx.onToolResult?.(execResult)
    return {
      result: {
        type: "tool-result" as const,
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        output: {
          type: "text",
          value: execResult?.success
            ? `OK: ${execResult.output ?? '(无输出)'}`
            : `Error: ${execResult?.error ?? '未知错误'}`,
        },
      },
      event,
    }
  }))

  return {
    results: results.map(r => r.result),
    events: results.map(r => r.event),
  }
}