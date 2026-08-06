/**
 * runAgentLoop - 纯函数版本的 agent 循环
 * 
 * 参考 pi 的 packages/agent/src/agent-loop.ts
 * 把 execute() 循环体搬进来，只 emit 事件，不直接碰 TUI/session 写
 * session 持久化通过回调传入
 */

import { type DynamicToolCall, type ImagePart, type TextPart, type Tool, type ToolResultPart, jsonSchema, streamText, tool } from "ai"
import type { ToolResult } from "../../../tools/types"
import { globalToolRegistry } from "../../../tools/registry"
import { buildProjectRole, detectProject } from "../../detect-project"
import { devLogger } from "../../dev-logger"
import { type SubagentInput, SubagentManager } from "../../subagent"
import { zodToJsonSchema } from "../../utils"
import {
  IntelligenceAdapter,
  defaultRegistry,
  type ToolCallEvent,
} from "../../intelligence"
import type { AgentEvent, EventEmitter } from "../../events"
import { createEvent } from "../../events"
import { SYSTEM_PROMPT } from "./prompts"
import { loadProjectConfig } from "./load-config"
import { findValidStart } from "./helpers"
import { buildSystem } from "./main"
import type { ExecuteContext, MessageContent } from "./context"
import type { LanguageModel } from "ai"

const MAX_ITERATIONS = 100

// ============================================================
// 类型定义
// ============================================================

/** 运行循环上下文 */
export interface RunLoopContext {
  /** LLM 模型 */
  model: LanguageModel
  /** 用户输入 */
  userInput: string
  /** 用户图片 */
  userImages?: Array<{ base64: string; mimeType: string }>
  /** 工作目录 */
  cwd: string
  /** 会话 ID */
  sessionId: string
  /** 历史消息 */
  history?: Array<{ role: string; content: MessageContent[] }>
  /** 会话摘要 */
  sessionSummary?: string
  /** 信号（用于取消） */
  signal?: AbortSignal
  /** 技能相关 */
  activeSkill?: string | null
  activeSkillInstructions?: string | null
  availableSkills?: Array<{ name: string; description: string; triggerHints: string; path?: string }>
  skillStack?: Array<{ skill: { name: string; description: string }; role: 'primary' | 'secondary'; instructions: string }>
  /** Memory */
  memory?: any
  /** 模型信息 */
  modelInfo?: { modelId: string; provider: string }
  /** Timer */
  timer?: any
}

/** 持久化回调 */
export interface PersistenceCallbacks {
  /** 持久化消息 */
  persistMessage: (role: string, content: MessageContent[]) => void
  /** 持久化 assistant 文本 */
  persistAssistantText: (text: string, usage?: any) => void
}

/** LLM 结果 */
interface LLMResult {
  text?: string
  toolCalls?: DynamicToolCall[]
  usage: any
  finishReason: string
}

// ============================================================
// 工具辅助函数
// ============================================================

async function callLLM(
  msgs: Array<{ role: string; content: MessageContent[] }>,
  ctx: RunLoopContext,
  tools: Record<string, Tool>,
  system: string,
): Promise<{ result: LLMResult; duration: number } | null> {
  const startTime = Date.now()
  const timeoutMs = 60_000
  const timeoutController = new AbortController()
  const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs)

  const combinedSignal = ctx.signal
    ? AbortSignal.any([ctx.signal, timeoutController.signal])
    : timeoutController.signal

  try {
    const result = await streamText({
      model: ctx.model as any,
      messages: msgs as any,
      tools,
      maxSteps: 50,
      system,
      temperature: 0.3,
      signal: combinedSignal as any,
      onStepFinish: async ({ toolCalls, toolResults }) => {
        // 工具执行完成回调（可扩展）
      },
    })

    let fullText = ""
    for await (const chunk of result.textStream) {
      fullText += chunk
    }

    const usage = await result.usage
    const toolCalls = await result.toolCalls

    return {
      result: {
        text: fullText,
        toolCalls,
        usage,
        finishReason: (await result.finishReason) || 'stop',
      },
      duration: Date.now() - startTime,
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      return null // 用户取消
    }
    throw e
  } finally {
    clearTimeout(timeoutId)
  }
}

function buildInitialMessages(ctx: RunLoopContext): Array<{ role: string; content: MessageContent[] }> {
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

  history = findValidStart(history) > 0 ? history.slice(findValidStart(history)) : history

  const userContent: Array<TextPart | ImagePart> = [{ type: "text", text: ctx.userInput }]
  if (ctx.userImages?.length) {
    for (const img of ctx.userImages) {
      userContent.push({ type: "image", image: Buffer.from(img.base64, 'base64'), mimeType: img.mimeType as any })
    }
  }

  return [...history, { role: "user", content: userContent }]
}

function repairHistory(msgs: Array<{ role: string; content: MessageContent[] }>): Array<{ role: string; content: MessageContent[] }> {
  const callIds = new Set<string>()
  const resultIds = new Set<string>()
  for (const m of msgs) {
    if (Array.isArray(m.content)) {
      for (const p of m.content) {
        if (p.type === 'tool-call') callIds.add(p.toolCallId)
        if (p.type === 'tool-result') resultIds.add(p.toolCallId)
      }
    }
  }

  return msgs
    .map(m => {
      if (!Array.isArray(m.content)) return m
      let cleaned = m.content
      if (m.role === 'assistant') {
        cleaned = cleaned.filter(p => p.type !== 'tool-call' || resultIds.has(p.toolCallId))
      }
      if (m.role === 'tool') {
        cleaned = cleaned.filter(p => p.type !== 'tool-result' || callIds.has(p.toolCallId))
      }
      return cleaned.length === 0 ? null : (cleaned.length === m.content.length ? m : { ...m, content: cleaned })
    })
    .filter((m): m is NonNullable<typeof m> => m !== null)
}

// ============================================================
// 主循环（纯函数）
// ============================================================

/**
 * 运行 agent 循环
 * 
 * 纯函数设计：只通过 emit 事件和回调通知外部，不直接修改外部状态
 */
export async function runAgentLoop(
  ctx: RunLoopContext,
  emit: EventEmitter['emit'],
  persistence?: PersistenceCallbacks,
): Promise<{ text: string; iterations: number; usage: { input: number; output: number } }> {
  if (!ctx.model) return { text: "请配置 LLM provider", iterations: 0, usage: { input: 0, output: 0 } }

  // 初始化工具
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
    execute: async ({ task, tools: allowedTools, timeoutMs }) => {
      const subagentInput: SubagentInput = { task, tools: allowedTools, timeoutMs }
      try {
        const result = await subagentManager.execute(subagentInput, ctx.model as any, subagentSystem)
        return result
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    },
  })

  // Intelligence adapter
  const intelligenceAdapter = new IntelligenceAdapter({ registry: defaultRegistry() })
  let intelligenceHints = ""
  if (ctx.memory && ctx.sessionId && ctx.cwd) {
    try {
      const augmented = await intelligenceAdapter.beforeExecute({
        cwd: ctx.cwd,
        sessionId: ctx.sessionId,
        userInput: ctx.userInput,
        modelInfo: ctx.modelInfo ?? { modelId: 'unknown', provider: 'unknown' },
        memory: ctx.memory,
        executeContext: ctx as any,
      })
      intelligenceHints = augmented.systemHints
    } catch (e) {
      devLogger.warn('EXEC', `intelligenceAdapter.beforeExecute failed: ${e}`)
    }
  }

  // 发射 agent_start 事件
  emit(createEvent({
    type: 'agent_start',
    sessionId: ctx.sessionId,
    userInput: ctx.userInput,
    model: ctx.modelInfo?.modelId ?? 'unknown',
    provider: ctx.modelInfo?.provider ?? 'unknown',
  }))

  // 构建初始消息
  const msgs = buildInitialMessages(ctx)
  let fullText = ""
  let lastChunk = ""
  let totalIterations = 0

  try {
    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      totalIterations = iteration + 1

      // 发射 turn_start 事件
      emit(createEvent({
        type: 'turn_start',
        iteration,
        messageCount: msgs.length,
      }))

      if (iteration === MAX_ITERATIONS - 1) {
        msgs.push({ role: "user", content: [{ type: "text", text: "[系统提醒] 这是最后一步，请直接给出最终回复。" }] })
      }

      const projectConfig = await loadProjectConfig(ctx.cwd)
      const systemPrompt = buildSystem(ctx, projectConfig, intelligenceHints)
      const llmResponse = await callLLM(msgs, ctx, tools, systemPrompt)

      if (!llmResponse) {
        // 用户取消
        emit(createEvent({
          type: 'error',
          error: '已取消当前执行',
          context: 'llm_call',
          iteration,
        }))
        break
      }

      const { result } = llmResponse

      // 超时处理
      if (result.finishReason === 'timeout') {
        emit(createEvent({
          type: 'error',
          error: 'LLM 调用超时（60 秒）',
          context: 'timeout',
          iteration,
        }))
        break
      }

      // 发射 message 事件
      if (result.text) {
        emit(createEvent({
          type: 'message_start',
          role: 'assistant',
        }))

        if (result.toolCalls?.length) {
          lastChunk = result.text
          emit(createEvent({
            type: 'message_delta',
            delta: result.text,
            isIntermediate: true,
          }))
        } else {
          fullText = result.text
          lastChunk = result.text
        }

        emit(createEvent({
          type: 'message_end',
          role: 'assistant',
          text: result.text,
          usage: result.usage,
        }))
      }

      // 无工具调用 → 持久化并返回
      if (!result.toolCalls?.length) {
        persistence?.persistMessage('assistant', [{ type: 'text', text: fullText }])
        break
      }

      // 有工具调用 → 追加 assistant 消息 + 执行工具
      const assistantContent: MessageContent[] = []
      if (result.text) assistantContent.push({ type: "text", text: result.text })
      for (const tc of result.toolCalls) {
        assistantContent.push({ type: "tool-call", toolCallId: tc.toolCallId, toolName: tc.toolName, input: tc.input })

        // 发射 tool_start 事件
        emit(createEvent({
          type: 'tool_start',
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          args: tc.input as Record<string, unknown>,
          batch: iteration,
        }))
      }
      msgs.push({ role: "assistant", content: assistantContent })
      persistence?.persistMessage('assistant', assistantContent)

      // 执行工具（这里简化处理，实际应使用 executeToolBatch）
      const toolResults: ToolResultPart[] = []
      for (const tc of result.toolCalls) {
        const startTime = Date.now()
        let toolResult: any
        try {
          const toolDef = tools[tc.toolName]
          if (toolDef?.execute) {
            toolResult = await toolDef.execute(tc.input as any, { cwd: ctx.cwd, sessionId: ctx.sessionId, signal: ctx.signal })
          } else {
            toolResult = { success: false, error: `Tool ${tc.toolName} not found` }
          }
        } catch (e) {
          toolResult = { success: false, error: e instanceof Error ? e.message : String(e) }
        }

        const durationMs = Date.now() - startTime
        const output = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult)

        toolResults.push({
          type: 'tool-result',
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          result: toolResult,
        } as any)

        // 发射 tool_result 事件
        emit(createEvent({
          type: 'tool_result',
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          success: toolResult?.success !== false,
          output: toolResult?.output ?? toolResult?.result,
          error: toolResult?.error,
          durationMs,
        }))
      }

      msgs.push({ role: "tool", content: toolResults })
      persistence?.persistMessage('tool', toolResults as any)

      // Intelligence afterExecute
      if (ctx.memory && ctx.sessionId && ctx.cwd) {
        const events: ToolCallEvent[] = result.toolCalls.map((tc, i) => ({
          tool: tc.toolName,
          success: (toolResults[i] as any)?.result?.success !== false,
          durationMs: 0, // TODO: 计算实际耗时
        }))
        try {
          await intelligenceAdapter.afterExecute({
            cwd: ctx.cwd,
            sessionId: ctx.sessionId,
            userInput: ctx.userInput,
            modelInfo: ctx.modelInfo ?? { modelId: 'unknown', provider: 'unknown' },
            memory: ctx.memory,
          }, events)
        } catch (e) {
          devLogger.warn('EXEC', `intelligenceAdapter.afterExecute failed: ${e}`)
        }
      }

      // 发射 turn_end 事件
      emit(createEvent({
        type: 'turn_end',
        iteration,
        hasToolCalls: true,
        finishReason: result.finishReason,
      }))
    }
  } catch (e) {
    devLogger.logException('runAgentLoop', e, { iteration: totalIterations, messageCount: msgs.length })
    emit(createEvent({
      type: 'error',
      error: e instanceof Error ? e : new Error(String(e)),
      context: 'main_loop',
      iteration: totalIterations,
    }))
  }

  // 发射 agent_end 事件
  emit(createEvent({
    type: 'agent_end',
    sessionId: ctx.sessionId,
    totalIterations,
  }))

  return {
    text: fullText || lastChunk || "已达到最大迭代次数",
    iterations: totalIterations,
    usage: { input: 0, output: 0 }, // TODO: 从 response 中提取
  }
}
