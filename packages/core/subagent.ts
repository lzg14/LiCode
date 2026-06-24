/**
 * 简化版多 Agent 支持
 *
 * 设计原则（对比 MiMo Code）：
 * - 不使用 Effect/Fiber，用原生 Promise
 * - 不实现 Inbox，用结果返回
 * - 不实现 TaskRegistry，用简单结果聚合
 * - 不实现 fork session，子 agent 共享父 session 消息上下文
 */

import { generateText } from "ai"
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
  /** 是否后台运行（目前无实际区别，第一版简化） */
  background?: boolean
}

/** 子 agent 执行结果 */
export interface SubagentResult {
  success: boolean
  text?: string
  error?: string
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
 * 1. spawn() — 创建一个子 agent 执行任务
 * 2. runMultiple() — 并发运行多个子 agent（受 maxConcurrent 限制）
 */
export class SubagentManager {
  private running = 0
  private queue: Array<() => void> = []

  constructor(private options: SubagentOptions) {}

  /**
   * 创建一个子 agent 执行任务
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
      const tools = this.buildTools(input.tools)
      const timeout = input.timeoutMs ?? this.options.timeoutMs

      const result = await Promise.race([
        generateText({
          model: ctx.model,
          system: ctx.system,
          messages: [...ctx.messages, { role: "user", content: [{ type: "text", text: input.task }] }],
          tools,
          temperature: 0.7,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Subagent timeout after ${timeout}ms`)), timeout)
        ),
      ])

      devLogger.debug("SUBAGENT", `spawn completed in ${Date.now() - start}ms`)

      return {
        success: true,
        text: result.text || "(无输出)",
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

  /** 构建工具列表 */
  private buildTools(allowed?: string[]): Record<string, any> {
    const allTools = globalToolRegistry.list()
    const blocked = new Set(this.options.blockedTools)

    const filtered = allowed?.length
      ? allTools.filter((t) => allowed.includes(t.name) && !blocked.has(t.name))
      : allTools.filter((t) => !blocked.has(t.name))

    const tools: Record<string, any> = {}
    for (const t of filtered) {
      const jsonSchemaDef = zodToJsonSchema(t.inputSchema)
      tools[t.name] = {
        description: t.description,
        parameters: jsonSchemaDef,
      }
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
