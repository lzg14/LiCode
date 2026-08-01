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
import type { ExecuteContext, MessageContent } from "./context"
import { SYSTEM_PROMPT } from "./prompts"
import { loadProjectConfig } from "./load-config"
import { findValidStart } from "./helpers"

const MAX_ITERATIONS = 100

// v2 §4.M5: 决策整合 adapter（per-execute 实例，避免跨 session 污染）
const intelligenceAdapter = new IntelligenceAdapter({ registry: defaultRegistry() })

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

  // 60 秒超时自动 abort，防止 LLM API 卡死导致 TUI 永远 "等待响应中"
  const timeoutMs = 60_000
  const timeoutController = new AbortController()
  const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs)

  // 合并用户 abort + 超时 abort
  const combinedSignal = ctx.signal
    ? AbortSignal.any([ctx.signal, timeoutController.signal])
    : timeoutController.signal

  const streamResult = streamText({
    model: ctx.model,
    system,
    messages: msgs as any,
    tools,
    temperature: 0.7,
    abortSignal: combinedSignal,
  })

  // 内存泄漏修复（关键）：
  // AI SDK v6 的 streamResult 内部用 createStitchableStream 维护 fullStream / baseStream
  // 以及所有 chunk reader。streamResult.text / .toolCalls / .usage 这些 getter **不**
  // 触发清理，只有 .finishReason / .totalUsage / .rawFinishReason 会隐式调
  // consumeStream()。
  // 旧代码在 abort / timeout / 异常路径直接 return，根本没访问 finishReason
  // → stitchableStream 永远挂着 → 持续引用 LLM 响应 buffer / tool-call
  // parser state / abort signal listener → 长期运行的 TUI 内存只增不减
  // （用户实测 5GB+）。
  // 修复：用 try/finally 在所有退出路径强制 await streamResult.consumeStream()。
  let aborted = false
  let timedOut = false

  try {
    // 消费流（触发 token 生成）
    // 注意：必须用 textStream 而非 fullStream——fullStream 会触发 AI SDK v6
    // 的 tool-call/tool-result 配对校验，而 licode 在流消费完后才执行工具，
    // fullStream 会在 await streamResult.toolCalls 时报 "Tool results are missing"
    try {
      for await (const text of streamResult.textStream) {
        clearTimeout(timeoutId)
        ctx.onStreamText?.(text)
      }
    } catch (streamError: any) {
      clearTimeout(timeoutId)
      if (streamError?.name === 'AbortError' || ctx.signal?.aborted) {
        aborted = true
        devLogger.info('STREAM', 'Stream aborted by user')
      } else if (timeoutController.signal.aborted) {
        timedOut = true
        devLogger.warn('STREAM', `LLM call timed out after ${timeoutMs}ms`)
      } else {
        devLogger.warn('STREAM', `stream consumption failed: ${streamError?.message ?? streamError}`)
      }
      // 关键：非 abort/timeout 的 stream 异常也必须立刻返回。
      // 旧代码会继续走下方 Promise.all，触发 streamResult.text / .toolCalls 这些
      // lazy promise —— 这些 promise 可能 hang（因为 fullStream 没被消费）或再次泄漏
      // 内部 buffer。修复：直接走 finally 清理后返回 null。
      if (!aborted && !timedOut) return null
    }
    clearTimeout(timeoutId)

    if (aborted) return null
    if (timedOut) return { result: { text: undefined, usage: {} as any, finishReason: 'timeout' }, duration: Date.now() - startTime }

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
  } finally {
    // 强制清理 streamResult 内部 stitchableStream + baseStream + 所有 reader。
    // 必须 await：否则 internal promise 还活着，引用链断不了。
    //
    // 1) 正常完成路径：finishReason getter 内部已调过 consumeStream() —— 这里
    //    再次调用是 idempotent（fullStream reader 已 done，consumeStream 立即 resolve）。
    // 2) abort / timeout 路径：必须显式触发，AI SDK 才能关闭 stitchableStream 并
    //    释放所有 chunk buffer + abort listener。
    // 3) 异常路径：同上。
    //
    // 测试 mock 可能没有 consumeStream 方法（execute-e2e / execute-stream-error
    // 的简化 mock），用 typeof 兼容。
    const consume = (streamResult as { consumeStream?: (opts?: { onError?: (e: unknown) => void }) => PromiseLike<void> }).consumeStream
    if (typeof consume === 'function') {
      // 2 秒上限：abort 后网络请求已取消，正常情况立即 done；2 秒是兜底
      // 防止 consumeStream 本身 hang（极端情况 abort signal 未传到 AI SDK 内部时）
      try {
        await Promise.race([
          consume.call(streamResult, {
            onError: (e: unknown) => {
              devLogger.debug('STREAM', `consumeStream cleanup swallowed: ${e instanceof Error ? e.message : String(e)}`)
            },
          }),
          new Promise<void>(resolve => setTimeout(resolve, 2000)),
        ])
      } catch (cleanupError) {
        // cleanup 错误不影响主流程，swallow 即可
        devLogger.debug('STREAM', `streamResult cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`)
      }
    }
  }
}

// ─── 工具执行 ───────────────────────────────────────────
//
// v2 §4.M5 集成：返回 events 给 caller 调 afterExecute。
// 这里不直接调 recorder，因为 executeToolBatch 是纯函数（v2 §2.5），
// 让 caller 决定何时 record（一次 / 分批 / 失败回滚）

interface ToolBatchResult {
  results: ToolResultPart[]
  events: ToolCallEvent[]
}

async function executeToolBatch(
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
      // 显式适配成 ToolResult 形状，让下游 main.ts:213 读 execResult.output 拿到真实输出
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
    results: results.map((r) => r.result),
    events: results.map((r) => r.event),
  }
}

// ─── 构建 system prompt ─────────────────────────────────
//
// v2 §4.M5: 追加 augmentedPrompt.systemHints（来自 M5 adapter beforeExecute）
// 顺序：SYSTEM_PROMPT → projectConfig → activeSkill → intelligenceAdapter hints

function buildSystem(
  ctx: ExecuteContext,
  projectConfig: string,
  intelligenceHints: string,
): string {
  const projectInfo = detectProject(ctx.cwd ?? process.cwd())
  const projectRole = buildProjectRole(projectInfo)
  let sys = SYSTEM_PROMPT.replace('你是一个名为 licode 的 AI 助手，专注于代码开发。', projectRole)
  if (projectConfig) sys += `\n\n## 项目配置\n\n${projectConfig}`
  if (ctx.activeSkillInstructions) {
    sys += `\n\n## 当前激活技能: ${ctx.activeSkill ?? "?"}\n\n${ctx.activeSkillInstructions}\n\n请严格遵循上述技能的指令与规则。`
  }
  // 注入可用 skill 索引（让 AI 知道有哪些 skill 可调用）
  if (ctx.availableSkills && ctx.availableSkills.length > 0) {
    sys += `\n\n## 可用技能\n\n以下技能可通过 \`skill\` 工具激活。当用户任务匹配触发条件时，应先激活对应技能再执行。\n\n`
    sys += `| 技能 | 描述 | 何时用 |\n|------|------|--------|\n`
    for (const s of ctx.availableSkills) {
      const hints = s.triggerHints || '-'
      sys += `| ${s.name} | ${s.description || '-'} | ${hints} |\n`
    }
    sys += `\n激活方式：调用 \`skill\` 工具，参数 \`{ "name": "<技能名>" }\`。`
  }
  if (intelligenceHints) {
    sys += `\n\n${intelligenceHints}`
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

  // v2 §4.M5: beforeExecute → 收集 4 类信号 → 输出 AugmentedPrompt
  let intelligenceHints = ""
  if (ctx.memory && ctx.sessionId && ctx.cwd) {
    try {
      const augmented = await intelligenceAdapter.beforeExecute({
        cwd: ctx.cwd,
        sessionId: ctx.sessionId,
        userInput: ctx.userInput,
        modelInfo: ctx.modelInfo ?? { modelId: 'unknown', provider: 'unknown' },
        memory: ctx.memory,
        executeContext: ctx,
      })
      intelligenceHints = augmented.systemHints
    } catch (e) {
      // 整体失败不 crash，hints 留空（走原 LLM 行为）
      devLogger.warn('EXEC', `intelligenceAdapter.beforeExecute failed: ${e}`)
    }
  }

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
      const llmResponse = await callLLM(msgs, ctx, tools, buildSystem(ctx, projectConfig, intelligenceHints))
      if (!llmResponse) return "已取消当前执行"
      const { result } = llmResponse

      // 超时处理
      if (result.finishReason === 'timeout') {
        return "LLM 调用超时（60 秒），请检查网络连接或 provider 配置"
      }

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

      const batch = await executeToolBatch(result.toolCalls, msgs, subagentManager, subagentSystem, ctx)
      msgs.push({ role: "tool", content: batch.results })
      persistContent(ctx, 'tool', batch.results)

      // v2 §4.M5: afterExecute → recorder 写入 M4 tool-stats
      if (ctx.memory && ctx.sessionId && ctx.cwd && batch.events.length > 0) {
        await intelligenceAdapter.afterExecute({
          cwd: ctx.cwd,
          sessionId: ctx.sessionId,
          userInput: ctx.userInput,
          modelInfo: ctx.modelInfo ?? { modelId: 'unknown', provider: 'unknown' },
          memory: ctx.memory,
        }, batch.events)
      }

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

/**
 * 修复可能损坏的消息历史：
 * 1. 移除 assistant 消息中无对应 tool-result 的 tool-call part（中断/取消产生）
 * 2. 移除 role='tool' 的消息中无对应 tool-call 的 tool-result part（slice 产生）
 * 3. 移除 content 为空的无效消息
 */
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

  history = repairHistory(history)

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
