/**
 * 简化版多 Agent 支持
 *
 * 设计原则（对比 MiMo Code）：
 * - 不使用 Effect/Fiber，用原生 Promise
 * - 不实现 Inbox，用结果返回
 * - 不实现 TaskRegistry，用简单结果聚合
 * - 不实现 fork session，子 agent 共享父 session 消息上下文
 */

import { generateText, tool, jsonSchema } from "ai"
import { globalToolRegistry } from "../tools/registry"
import { devLogger } from "./dev-logger"
import { z } from "zod"

/** 子 agent 输入 */
export interface SubagentInput {
  /** 任务描述 */
  task: string
  /** 可用工具白名单（空 = 全部可用） */
  tools?: string[]
  /** 超时毫秒（默认继承全局配置） */
  timeoutMs?: number
}

/** 子 agent 执行结果 */
export interface SubagentResult {
  success: boolean
  text?: string
  error?: string
  toolResults?: Array<{ tool: string; output: string }>
  durationMs: number
}

/** 并发运行多个子 agent 的结果 */
export interface MultipleSubagentResult {
  results: SubagentResult[]
  totalDurationMs: number
}

/** 全局配置（来自 SubagentConfig） */
export interface SubagentOptions {
  maxConcurrent: number
  timeoutMs: number
  blockedTools: string[]
}

function zodToJsonSchema(schema: any): any {
  const raw: any = z.toJSONSchema(schema, { target: "draft-7" })
  delete raw.$schema
  return raw
}

/**
 * SubagentManager — 简化的子 agent 生命周期管理
 *
 * 核心能力：
 * 1. spawn() — 创建一个子 agent 执行任务（带工具执行循环）
 * 2. runMultiple() — 并发运行多个子 agent（受 maxConcurrent 限制）
 */
export class SubagentManager {
  private running = 0
  private queue: Array<() => void> = []

  constructor(private options: SubagentOptions) {}

  /**
   * 创建一个子 agent 执行任务（含工具执行循环）
   */
  async spawn(
    input: SubagentInput,
    ctx: {
      model: any
      system: string
      messages: any[]
      cwd: string
    }
  ): Promise<SubagentResult> {
    // 检查并发上限
    while (this.running >= this.options.maxConcurrent) {
      await new Promise<void>((resolve) => this.queue.push(resolve))
    }

    this.running++
    const start = Date.now()

    try {
      const timeout = input.timeoutMs ?? this.options.timeoutMs
      const allowedTools = this.buildToolsWithExecute(input.tools, ctx.cwd)

      // 构建消息：历史 + 当前任务
      const taskMessage = { role: "user" as const, content: [{ type: "text" as const, text: input.task }] }
      const allMessages = [...ctx.messages, taskMessage]

      let iteration = 0
      const MAX_TOOL_ITERATIONS = 20
      let accumulatedText = ""

      while (iteration < MAX_TOOL_ITERATIONS) {
        iteration++

        const result = await Promise.race([
          generateText({
            model: ctx.model,
            system: ctx.system,
            messages: allMessages,
            tools: allowedTools,
            temperature: 0.7,
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Subagent timeout after ${timeout}ms`)), timeout)
          ),
        ])

        // 收集文本输出
        if (result.text) {
          accumulatedText += result.text + "\n"
        }

        // 没有 tool calls 说明任务完成
        if (!result.toolCalls || result.toolCalls.length === 0) {
          break
        }

        // 执行工具调用
        const toolResults = await Promise.all(
          result.toolCalls.map(async (tc: any) => {
            devLogger.debug("SUBAGENT-TOOL", `${tc.toolName}`, tc.input)
            try {
              const execResult = await globalToolRegistry.execute(tc.toolName, tc.input as Record<string, unknown>, { cwd: ctx.cwd })
              return {
                toolCallId: tc.toolCallId,
                toolName: tc.toolName,
                output: {
                  type: "text" as const,
                  value: execResult.success
                    ? `OK: ${execResult.output ?? "(无输出)"}`
                    : `Error: ${execResult.error ?? "未知错误"}`,
                },
              }
            } catch (e) {
              const err = e instanceof Error ? e.message : String(e)
              return {
                toolCallId: tc.toolCallId,
                toolName: tc.toolName,
                output: { type: "text" as const, value: `Error: ${err}` },
              }
            }
          })
        )

        // 把工具结果追加到消息历史
        allMessages.push({
          role: "assistant",
          content: [
            ...(result.text ? [{ type: "text" as const, text: result.text }] : []),
            ...result.toolCalls.map((tc: any) => ({
              type: "tool-call" as const,
              toolCallId: tc.toolCallId,
              toolName: tc.toolName,
              input: tc.input,
            })),
          ],
        })
        allMessages.push({ role: "tool", content: toolResults })
      }

      devLogger.debug("SUBAGENT", `spawn completed in ${Date.now() - start}ms (${iteration} iterations)`)

      return {
        success: true,
        text: accumulatedText.trim() || "(无输出)",
        durationMs: Date.now() - start,
      }
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e)
      devLogger.debug("SUBAGENT", `spawn error: ${err}`)
      return {
        success: false,
        error: err,
        durationMs: Date.now() - start,
      }
    } finally {
      this.running--
      const next = this.queue.shift()
      if (next) next()
    }
  }

  /**
   * 并发运行多个子 agent
   * 自动控制并发数量，结果按原始顺序返回
   */
  async runMultiple(
    inputs: SubagentInput[],
    ctx: {
      model: any
      system: string
      messages: any[]
      cwd: string
    }
  ): Promise<MultipleSubagentResult> {
    const start = Date.now()
    const results: SubagentResult[] = new Array(inputs.length)

    await Promise.all(
      inputs.map((input, index) =>
        this.spawn(input, ctx).then((result) => {
          results[index] = result
        })
      )
    )

    return {
      results,
      totalDurationMs: Date.now() - start,
    }
  }

  /** 构建带 execute 的工具列表 */
  private buildToolsWithExecute(allowed?: string[], cwd?: string): Record<string, any> {
    const allTools = globalToolRegistry.list()
    const blocked = new Set(this.options.blockedTools)

    const filtered = allowed?.length
      ? allTools.filter((t) => allowed.includes(t.name) && !blocked.has(t.name))
      : allTools.filter((t) => !blocked.has(t.name))

    const tools: Record<string, any> = {}
    for (const t of filtered) {
      const jsonSchemaDef = zodToJsonSchema(t.inputSchema)

      tools[t.name] = tool({
        description: t.description,
        inputSchema: jsonSchema(jsonSchemaDef),
        // AI SDK v6: execute 函数让 generateText 自动执行工具
        execute: async (args: Record<string, unknown>) => {
          try {
            const result = await globalToolRegistry.execute(t.name, args, { cwd: cwd ?? process.cwd() })
            return result.success
              ? `OK: ${result.output ?? "(无输出)"}`
              : `Error: ${result.error ?? "未知错误"}`
          } catch (e) {
            const err = e instanceof Error ? e.message : String(e)
            return `Error: ${err}`
          }
        },
      } as any)
    }

    return tools
  }

  /** 当前运行中的 agent 数 */
  getRunningCount(): number {
    return this.running
  }

  /** 等待队列长度 */
  getQueueLength(): number {
    return this.queue.length
  }
}
