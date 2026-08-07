import { type DynamicToolCall, type Tool, streamText } from "ai"
import type { ExecuteContext, MessageContent } from "./phases/execute/context"
import { devLogger } from "./dev-logger"

export interface LLMResult {
  text?: string
  toolCalls?: DynamicToolCall[]
  usage: any
  finishReason: string
}

export interface LLMResponse {
  result: LLMResult
  duration: number
}

/**
 * LLM 调用 + 流消费
 *
 * 封装 AI SDK v6 的 streamText 调用、60 秒超时 abort、用户 abort 合并、
 * 流消费、usage 统计与内存泄漏防护。
 */
export async function callLLM(
  msgs: Array<{ role: string; content: MessageContent[] }>,
  ctx: ExecuteContext,
  tools: Record<string, Tool>,
  system: string,
): Promise<LLMResponse | null> {
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
      // 否则继续走下方 Promise.all，触发 streamResult.text / .toolCalls 这些
      // lazy promise —— 这些 promise 可能 hang（因为 fullStream 没被消费）或再次泄漏。
      if (!aborted && !timedOut) return null
    }
    clearTimeout(timeoutId)

    if (aborted) return null
    if (timedOut) return { result: { text: undefined, usage: {} as any, finishReason: 'timeout' }, duration: Date.now() - startTime }

    const safeAwait = async <T>(p: PromiseLike<T> | undefined, fallback: T, label: string): Promise<T> => {
      try { return p !== undefined ? await p : fallback }
      catch (e: any) { devLogger.warn('LLM', `result.${label} rejected: ${e?.message ?? e}`); return fallback }
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
    const consume = (streamResult as { consumeStream?: (opts?: { onError?: (e: unknown) => void }) => PromiseLike<void> }).consumeStream
    if (typeof consume === 'function') {
      // 2 秒上限：abort 后网络请求已取消，正常情况立即 done；2 秒是兜底
      // 防止 consumeStream 本身 hang（极端情况 abort signal 未传到 AI SDK 内部时）
      try {
        await Promise.race([
          consume.call(streamResult, {
            onError: (e: unknown) => {
              devLogger.debug('LLM', `consumeStream cleanup swallowed: ${e instanceof Error ? e.message : String(e)}`)
            },
          }),
          new Promise<void>(resolve => setTimeout(resolve, 2000)),
        ])
      } catch (cleanupError) {
        // cleanup 错误不影响主流程，swallow 即可
        devLogger.debug('LLM', `streamResult cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`)
      }
    }
  }
}