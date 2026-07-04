import { type DynamicToolCall, type ImagePart, type TextPart, type Tool, type ToolResultPart, jsonSchema, streamText, tool } from "ai"
import type { ToolResult } from "../../../tools/types"
import { globalToolRegistry } from "../../../tools/registry"
import { buildProjectRole, detectProject } from "../../detect-project"
import { devLogger } from "../../dev-logger"
import { type SubagentInput, SubagentManager } from "../../subagent"
import { zodToJsonSchema } from "../../utils"
import type { ExecuteContext, MessageContent } from "./context"
import { SYSTEM_PROMPT } from "./prompts"
import { loadProjectConfig } from "./load-config"
import { findValidStart } from "./helpers"

const MAX_ITERATIONS = 100

// ─── LLM 调用 + 流消费 ──────────────────────────────────

interface LLMResult {
  text?: string
  toolCalls?: DynamicToolCall[]
  usage: any
  finishReason: string
}

async function callLLM(
  msgs: Array<{ role: string; content: MessageContent[] }>,
  ctx: ExecuteContext,
  tools: Record<string, Tool>,
  system: string,
): Promise<{ result: LLMResult; duration: number } | null> {
  const llmId = ctx.timer?.start('llm.generateText', { iteration: 0 })
  ctx.onLLMCall?.()
  const startTime = Date.now()

  const streamResult = streamText({
    model: ctx.model,
    system,
    messages: msgs as any,
    tools,
    temperature: 0.7,
    abortSignal: ctx.signal,
  })

  // 消费流（触发 token 生成）
  let aborted = false
  try {
    for await (const chunk of streamResult.fullStream) {
      if (chunk.type === 'text-delta') {
        ctx.onStreamText?.(chunk.text)
      }
    }
  } catch (streamError: any) {
    if (streamError?.name === 'AbortError' || ctx.signal?.aborted) {
      aborted = true
      devLogger.info('STREAM', 'Stream aborted by user')
    } else {
      devLogger.warn('STREAM', `stream consumption failed: ${streamError?.message ?? streamError}`)
    }
  }

  if (aborted) return null

  const safeAwait = async <T>(p: PromiseLike<T> | undefined, fallback: T, label: string): Promise<T> => {
    try { return p !== undefined ? await p : fallback }
    catch (e: any) { devLogger.warn('STREAM', `result.${label} rejected: ${e?.message ?? e}`); return fallback }
  }

  const [finalText, finalToolCalls, usage, finishReason] = await Promise.all([
    safeAwait(streamResult.text, '', 'text'),
    safeAwait(streamResult.toolCalls, [], 'toolCalls'),
    safeAwait(streamResult.usage, {} as any, 'usage'),
    safeAwait(streamResult.finishReason, 'unknown', 'finishReason'),
  ])

  const result: LLMResult = {
    text: finalText || undefined,
    toolCalls: finalToolCalls.length > 0 ? (finalToolCalls as DynamicToolCall[]) : undefined,
    usage,
    finishReason,
  }
  const duration = Date.now() - startTime

  // 记录日志 + token 回调
  if (result.usage) {
    ctx.onLLMResult?.({
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
      totalTokens: (result.usage.inputTokens ?? 0) + (result.usage.outputTokens ?? 0),
    })
  }
  if (llmId) ctx.timer?.end(llmId, {
    toolCalls: result.toolCalls?.length ?? 0,
    finishReason: result.finishReason ?? 'unknown',
  })
  devLogger.logLLMResponse({
    finishReason: result.finishReason,
    textLength: result.text?.length ?? 0,
    toolCalls: result.toolCalls?.map(tc => ({ tool: tc.toolName, input: tc.input })),
  }, duration)

  return { result, duration }
}

// ─── 工具执行 ───────────────────────────────────────────

async function executeToolBatch(
  toolCalls: DynamicToolCall[],
  msgs: Array<{ role: string; content: MessageContent[] }>,
  subagentManager: SubagentManager,
  subagentSystem: string,
  ctx: ExecuteContext,
): Promise<ToolResultPart[]> {
  devLogger.info('PARALLEL', `Executing ${toolCalls.length} tool(s)`)
  const toolBatch = msgs.filter(m => m.role === 'tool').length + 1

  return Promise.all(toolCalls.map(async (tc) => {
    devLogger.logToolCall(tc.toolName, tc.input)
    const tcInput = tc.input as Record<string, unknown>
    ctx.onToolCall?.(tc.toolName, tcInput, toolBatch)
    const toolId = ctx.timer?.start(`tool.${tc.toolName}`)
    let execResult: ToolResult | undefined

    if (tc.toolName === "subagent") {
      execResult = await subagentManager.spawn(
        { task: tcInput.task as string, tools: tcInput.tools as string[] | undefined, timeoutMs: tcInput.timeoutMs as number | undefined },
        { model: ctx.model, system: subagentSystem, messages: msgs.filter(m => m.role === "user" || m.role === "assistant"), cwd: ctx.cwd ?? process.cwd() },
      )
    } else {
      try {
        execResult = await globalToolRegistry.execute(tc.toolName, tcInput, { cwd: ctx.cwd })
      } catch (toolError: any) {
        execResult = { success: false, error: `工具执行异常: ${toolError?.message ?? toolError}` }
      }
    }

    devLogger.logToolCall(tc.toolName, tc.input, execResult)
    if (toolId) ctx.timer?.end(toolId, { success: execResult?.success ?? false })
    ctx.onToolResult?.(execResult)
    return {
      type: "tool-result" as const,
      toolCallId: tc.toolCallId,
      toolName: tc.toolName,
      output: {
        type: "text",
        value: execResult?.success
          ? `OK: ${execResult.output ?? '(无输出)'}`
          : `Error: ${execResult?.error ?? '未知错误'}`,
      },
    }
  }))
}

// ─── 构建 system prompt ─────────────────────────────────

function buildSystem(ctx: ExecuteContext, projectConfig: string): string {
  const projectInfo = detectProject(ctx.cwd ?? process.cwd())
  const projectRole = buildProjectRole(projectInfo)
  let sys = SYSTEM_PROMPT.replace('你是一个名为 licode 的 AI 助手，专注于代码开发。', projectRole)
  if (projectConfig) sys += `\n\n## 项目配置\n\n${projectConfig}`
  if (ctx.activeSkillInstructions) {
    sys += `\n\n## 当前激活技能: ${ctx.activeSkill ?? "?"}\n\n${ctx.activeSkillInstructions}\n\n请严格遵循上述技能的指令与规则。`
  }
  return sys
}

// ─── 主函数 ─────────────────────────────────────────────

export async function execute(ctx: ExecuteContext): Promise<string> {
  if (!ctx.model) return "请配置 LLM provider"

  const tools: Record<string, Tool> = {}
  for (const t of globalToolRegistry.list()) {
    tools[t.name] = tool({ description: t.description, inputSchema: jsonSchema(zodToJsonSchema(t.inputSchema)) })
  }

  const subagentManager = new SubagentManager({ maxConcurrent: 3, timeoutMs: 120000, blockedTools: ["subagent"] })
  const subagentSystem = "你是一个专注于代码开发的 AI 子助手。请用中文回答，独立完成分配给你的任务。只输出最终结果，不要有多余的解释。"

  tools.subagent = tool({
    description: "派发一个子任务给独立的 AI agent 并行执行。",
    inputSchema: jsonSchema({
      type: "object",
      properties: {
        task: { type: "string", description: "子任务描述" },
        tools: { type: "array", items: { type: "string" }, description: "允许使用的工具列表" },
        timeoutMs: { type: "number", description: "超时毫秒，默认 120000" },
      },
      required: ["task"],
    }),
  })

  // 构建初始消息列表
  const msgs = buildInitialMessages(ctx)
  let fullText = ""
  let lastChunk = ""
  let hasToolCalls = false

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    if (iteration === MAX_ITERATIONS - 1) {
      msgs.push({ role: "user", content: [{ type: "text", text: "[系统提醒] 这是最后一步，请直接给出最终回复。" }] })
    }

    try {
      const projectConfig = await loadProjectConfig(ctx.cwd)
      const llmResponse = await callLLM(msgs, ctx, tools, buildSystem(ctx, projectConfig))
      if (!llmResponse) return "已取消当前执行"
      const { result } = llmResponse

      if (result.text) {
        if (result.toolCalls?.length) {
          hasToolCalls = true
          lastChunk = result.text
          ctx.onIntermediateText?.(result.text)
        } else {
          fullText = result.text
          lastChunk = result.text
        }
      }

      // 无工具调用 → 持久化并返回
      if (!result.toolCalls?.length) {
        persistAssistantMessage(ctx, fullText, result)
        return fullText || ''
      }

      // 有工具调用 → 追加 assistant 消息 + 执行工具
      const assistantContent: MessageContent[] = []
      if (result.text) assistantContent.push({ type: "text", text: result.text })
      for (const tc of result.toolCalls) {
        assistantContent.push({ type: "tool-call", toolCallId: tc.toolCallId, toolName: tc.toolName, input: tc.input })
      }
      msgs.push({ role: "assistant", content: assistantContent })
      persistContent(ctx, 'assistant', assistantContent)

      const toolResults = await executeToolBatch(result.toolCalls, msgs, subagentManager, subagentSystem, ctx)
      msgs.push({ role: "tool", content: toolResults })
      persistContent(ctx, 'tool', toolResults)

    } catch (e) {
      devLogger.logException('execute.generateText', e, { iteration, messageCount: msgs.length })
      const error = e instanceof Error ? e.message : String(e)
      ctx.onStreamText?.(`[LLM Error] ${error}\n`)
      return `抱歉，AI 调用失败: ${error}`
    }
  }

  return fullText || lastChunk || "已达到最大迭代次数"
}

// ─── 辅助函数 ───────────────────────────────────────────

function buildInitialMessages(ctx: ExecuteContext): Array<{ role: string; content: MessageContent[] }> {
  const rawHistory = ctx.history ?? []
  const hasSummary = !!ctx.sessionSummary
  const PRESERVE_RECENT = hasSummary ? 100 : 200
  const sliced = rawHistory.length > PRESERVE_RECENT ? rawHistory.slice(-PRESERVE_RECENT) : rawHistory

  let history = sliced
  if (hasSummary) {
    history = sliced
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => {
        if (Array.isArray(m.content)) {
          const textParts = m.content.filter((p): p is TextPart => p.type === 'text')
          return textParts.length > 0 ? { ...m, content: textParts } : null
        }
        return m
      })
      .filter((m): m is NonNullable<typeof m> => m !== null)
  }

  const validStart = findValidStart(history)
  const validHistory = validStart > 0 ? history.slice(validStart) : history

  const lastInHistory = validHistory[validHistory.length - 1]
  const isDuplicate = lastInHistory
    && lastInHistory.role === 'user'
    && Array.isArray(lastInHistory.content)
    && lastInHistory.content.length === 1
    && lastInHistory.content[0]?.type === 'text'
    && lastInHistory.content[0]?.text === ctx.userInput

  const userContent: Array<TextPart | ImagePart> = [{ type: "text", text: ctx.userInput }]
  if (ctx.userImages?.length) {
    for (const img of ctx.userImages) {
      userContent.push({ type: "image", image: `data:${img.mimeType};base64,${img.base64}`, mediaType: img.mimeType })
    }
  }

  const msgs: Array<{ role: string; content: MessageContent[] }> = isDuplicate
    ? [...validHistory]
    : [...validHistory, { role: "user", content: userContent }]

  if (ctx.sessionSummary) {
    msgs.unshift(
      { role: "user", content: [{ type: "text", text: `[系统上下文] 以下是之前对话的摘要：\n\n${ctx.sessionSummary}\n\n请记住这些上下文，继续与用户对话。` }] },
      { role: "assistant", content: [{ type: "text", text: "好的，我已阅读之前的对话摘要，了解了项目背景。" }] }
    )
  }

  return msgs
}

function persistAssistantMessage(ctx: ExecuteContext, text: string, result: LLMResult): void {
  if (!ctx.sessionManager || !ctx.sessionId || !text) return
  const modelId = (ctx.model as any).modelId
  try {
    ctx.sessionManager.appendMessageWithParts({
      sessionId: ctx.sessionId,
      role: 'assistant',
      content: [{ type: 'text', text }],
      model: modelId,
      tokenUsage: result.usage
        ? { input: result.usage.inputTokens ?? 0, output: result.usage.outputTokens ?? 0,
            reasoning: (result.usage as Record<string, { reasoningTokens?: number }>).outputTokenDetails?.reasoningTokens }
        : undefined,
    })
  } catch (e) { devLogger.logException('execute.persistAssistant', e) }
}

function persistContent(ctx: ExecuteContext, role: string, content: MessageContent[]): void {
  if (!ctx.sessionManager || !ctx.sessionId) return
  const modelId = (ctx.model as any).modelId
  try {
    ctx.sessionManager.appendMessageWithParts({
      sessionId: ctx.sessionId, role: role as 'user' | 'assistant' | 'system' | 'tool', content,
      ...(role === 'assistant' ? { model: modelId } : {}),
    })
  } catch (e) { devLogger.logException(`execute.persist${role}`, e) }
}
