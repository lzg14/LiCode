import { jsonSchema, streamText, tool } from "ai"
import { globalToolRegistry } from "../../../tools/registry"
import { buildProjectRole, detectProject } from "../../detect-project"
import { devLogger } from "../../dev-logger"
import { type SubagentInput, SubagentManager } from "../../subagent"
import { zodToJsonSchema } from "../../utils"
import type { ExecuteContext } from "./context"
import { SYSTEM_PROMPT } from "./prompts"
import { loadProjectConfig } from "./load-config"
import { findValidStart } from "./helpers"

const MAX_ITERATIONS = 100

export async function execute(ctx: ExecuteContext): Promise<string> {
  if (!ctx.model) return "请配置 LLM provider"

  const tools: Record<string, any> = {}
  for (const t of globalToolRegistry.list()) {
    const jsonSchemaDef = zodToJsonSchema(t.inputSchema)

    tools[t.name] = tool({
      description: t.description,
      inputSchema: jsonSchema(jsonSchemaDef),
    })
  }

  const subagentManager = new SubagentManager({
    maxConcurrent: 3,
    timeoutMs: 120000,
    blockedTools: ["subagent"],
  })

  const subagentSystem = `你是一个专注于代码开发的 AI 子助手。
请用中文回答，独立完成分配给你的任务。
只输出最终结果，不要有多余的解释。`

  tools.subagent = tool({
    description: "派发一个子任务给独立的 AI agent 并行执行。适用于需要多路并行的场景（如同时搜索多个文件、同时分析多个模块）。输入任务描述和可选的工具白名单。",
    inputSchema: jsonSchema({
      type: "object",
      properties: {
        task: { type: "string", description: "子任务描述" },
        tools: { type: "array", items: { type: "string" }, description: "允许使用的工具列表，空表示全部可用" },
        timeoutMs: { type: "number", description: "超时毫秒，默认 120000" },
      },
      required: ["task"],
    }),
  })

  const rawHistory = ctx.history ?? []
  const hasSummary = !!ctx.sessionSummary
  const PRESERVE_RECENT = hasSummary ? 100 : 200
  const sliced = rawHistory.length > PRESERVE_RECENT
    ? rawHistory.slice(-PRESERVE_RECENT)
    : rawHistory

  let history: typeof rawHistory
  if (hasSummary) {
    history = sliced
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => {
        if (Array.isArray(m.content)) {
          const textParts = m.content.filter((p: any) => p.type === 'text')
          if (textParts.length === 0) return null
          return { ...m, content: textParts }
        }
        return m
      })
      .filter((m): m is NonNullable<typeof m> => m !== null)
  } else {
    history = sliced
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

  const userContent: any[] = [{ type: "text", text: ctx.userInput }]
  if (ctx.userImages?.length) {
    for (const img of ctx.userImages) {
      userContent.push({ type: "image", image: `data:${img.mimeType};base64,${img.base64}`, mediaType: img.mimeType })
    }
  }

  const msgs: any[] = isDuplicate
    ? [...validHistory]
    : [...validHistory, { role: "user", content: userContent }]

  if (ctx.sessionSummary) {
    msgs.unshift(
      { role: "user", content: [{ type: "text", text: `[系统上下文] 以下是之前对话的摘要，帮助你了解项目背景和已完成的工作：\n\n${ctx.sessionSummary}\n\n请记住这些上下文，继续与用户对话。` }] },
      { role: "assistant", content: [{ type: "text", text: "好的，我已阅读之前的对话摘要，了解了项目背景。" }] }
    )
  }

  let fullText = ""
  let lastChunk = ""
  let toolBatch = 0
  let hasToolCalls = false
  let totalIterations = 0

  while (true) {
    if (totalIterations === MAX_ITERATIONS - 1) {
      msgs.push({
        role: "user",
        content: [{ type: "text", text: "[系统提醒] 这是最后一步，请基于已有信息直接给出最终回复，不要再调用工具。" }],
      })
    }

    try {
      devLogger.logLLMRequest(
        ctx.model.modelId || 'unknown',
        ctx.model.provider || 'unknown',
        msgs,
        Object.keys(tools).length > 0 ? tools : undefined
      )
      const llmId = ctx.timer?.start('llm.generateText', { iteration: totalIterations })
      ctx.onLLMCall?.()
      const startTime = Date.now()
      const activeSkillContent = ctx.activeSkillInstructions
      const projectConfig = await loadProjectConfig(ctx.cwd)
      const projectInfo = detectProject(ctx.cwd ?? process.cwd())
      const projectRole = buildProjectRole(projectInfo)
      let fullSystem = SYSTEM_PROMPT.replace(
        '你是一个名为 licode 的 AI 助手，专注于代码开发。',
        projectRole
      )
      if (projectConfig) {
        fullSystem += `\n\n## 项目配置\n\n${projectConfig}`
      }
      if (activeSkillContent) {
        fullSystem += `\n\n## 当前激活技能: ${ctx.activeSkill ?? "?"}\n\n${activeSkillContent}\n\n请严格遵循上述技能的指令与规则。`
      }
      const streamResult = streamText({
        model: ctx.model,
        system: fullSystem,
        messages: msgs,
        tools,
        temperature: 0.7,
        abortSignal: ctx.signal,
      })

      let _chunkCount = 0
      let aborted = false
      try {
        for await (const chunk of streamResult.fullStream) {
          _chunkCount++
          if (chunk.type === 'text-delta') {
            ctx.onStreamText?.(chunk.text)
          }
        }
      } catch (streamError: any) {
        if (streamError?.name === 'AbortError' || ctx.signal?.aborted) {
          aborted = true
          devLogger.info('STREAM', 'Stream aborted by user')
        } else {
          devLogger.warn('STREAM', `stream consumption failed (will fall back to promise path): ${streamError?.message ?? streamError}`)
        }
      }

      if (aborted) {
        return "已取消当前执行"
      }

      const safeAwait = async (p: any, fallback: any, label: string): Promise<any> => {
        try {
          return await p
        } catch (e: any) {
          devLogger.warn('STREAM', `result.${label} promise rejected: ${e?.message ?? e}`)
          return fallback
        }
      }
      const [finalText, finalToolCalls, usage, finishReason]: [string, any[], any, string] = await Promise.all([
        safeAwait(streamResult.text, '', 'text'),
        safeAwait(streamResult.toolCalls, [], 'toolCalls'),
        safeAwait(streamResult.usage, { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, 'usage'),
        safeAwait(streamResult.finishReason, 'unknown', 'finishReason'),
      ])

      const resolvedResult = {
        text: finalText || undefined,
        toolCalls: finalToolCalls.length > 0 ? finalToolCalls : undefined,
        usage,
        finishReason,
      }
      const duration = Date.now() - startTime
      if (resolvedResult.usage) {
        ctx.onLLMResult?.({
          inputTokens: resolvedResult.usage.inputTokens ?? 0,
          outputTokens: resolvedResult.usage.outputTokens ?? 0,
          totalTokens: (resolvedResult.usage.inputTokens ?? 0) + (resolvedResult.usage.outputTokens ?? 0),
        })
      }
      if (llmId) ctx.timer?.end(llmId, {
        toolCalls: resolvedResult.toolCalls?.length ?? 0,
        finishReason: resolvedResult.finishReason ?? 'unknown',
      })
      devLogger.logLLMResponse({
        finishReason: resolvedResult.finishReason,
        textLength: resolvedResult.text?.length ?? 0,
        toolCalls: resolvedResult.toolCalls?.map((tc: any) => ({ tool: tc.toolName, input: tc.input })),
      }, duration)

      if (resolvedResult.text) {
        if (resolvedResult.toolCalls?.length) {
          hasToolCalls = true
          lastChunk = resolvedResult.text
          ctx.onIntermediateText?.(resolvedResult.text)
        } else {
          fullText = resolvedResult.text
          lastChunk = resolvedResult.text
        }
      }

      if (!resolvedResult.toolCalls?.length) {
        if (ctx.sessionManager && ctx.sessionId && fullText) {
          try {
            ctx.sessionManager.appendMessageWithParts({
              sessionId: ctx.sessionId,
              role: 'assistant',
              content: [{ type: 'text', text: fullText }],
              model: ctx.model.modelId,
              tokenUsage: resolvedResult.usage
                ? {
                    input: resolvedResult.usage.inputTokens ?? 0,
                    output: resolvedResult.usage.outputTokens ?? 0,
                    reasoning: (resolvedResult.usage as any).outputTokenDetails?.reasoningTokens,
                  }
                : undefined,
            })
          } catch (e) {
            devLogger.logException('execute.persistAssistant', e)
          }
        }

        return fullText || ''
      }

      const assistantContent: any[] = []
      if (resolvedResult.text) assistantContent.push({ type: "text", text: resolvedResult.text })
      for (const tc of resolvedResult.toolCalls) {
        assistantContent.push({ type: "tool-call", toolCallId: tc.toolCallId, toolName: tc.toolName, input: tc.input })
      }
      const assistantMsg = { role: "assistant", content: assistantContent }
      msgs.push(assistantMsg)

      if (ctx.sessionManager && ctx.sessionId) {
        try {
          ctx.sessionManager.appendMessageWithParts({
            sessionId: ctx.sessionId,
            role: 'assistant',
            content: assistantContent,
            model: ctx.model.modelId,
          })
        } catch (e) {
          devLogger.logException('execute.persistAssistantTool', e)
        }
      }

      toolBatch++
      devLogger.info('PARALLEL', `Executing ${resolvedResult.toolCalls.length} tool(s) in batch ${toolBatch}`)
      const toolResults: any[] = await Promise.all(resolvedResult.toolCalls.map(async (tc: any) => {
        devLogger.logToolCall(tc.toolName, tc.input)
        const tcInput = tc.input as Record<string, unknown>
        ctx.onToolCall?.(tc.toolName, tcInput, toolBatch)
        const toolId = ctx.timer?.start(`tool.${tc.toolName}`)
        let execResult: any

        if (tc.toolName === "subagent") {
          const subagentInput: SubagentInput = {
            task: tcInput.task as string,
            tools: tcInput.tools as string[] | undefined,
            timeoutMs: tcInput.timeoutMs as number | undefined,
          }
          execResult = await subagentManager.spawn(subagentInput, {
            model: ctx.model,
            system: subagentSystem,
            messages: msgs.filter(m => m.role === "user" || m.role === "assistant"),
            cwd: ctx.cwd ?? process.cwd(),
          })
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
              ? `OK: ${execResult.text ?? execResult.output ?? '(无输出)'}`
              : `Error: ${execResult.error ?? execResult?.error ?? '未知错误'}`,
          },
        }
      }))
      const toolMsg = { role: "tool", content: toolResults }
      msgs.push(toolMsg)

      if (ctx.sessionManager && ctx.sessionId) {
        try {
          ctx.sessionManager.appendMessageWithParts({
            sessionId: ctx.sessionId,
            role: 'tool',
            content: toolResults,
          })
        } catch (e) {
          devLogger.logException('execute.persistTool', e)
        }
      }

    } catch (e) {
      devLogger.logException('execute.generateText', e, { iteration: totalIterations, messageCount: msgs.length })
      const error = e instanceof Error ? e.message : String(e)
      ctx.onStreamText?.(`[LLM Error] ${error}\n`)
      return `抱歉，AI 调用失败: ${error}`
    }

    totalIterations++

    if (totalIterations >= MAX_ITERATIONS && hasToolCalls) {
      if (ctx.onConfirmContinue) {
        const shouldContinue = await ctx.onConfirmContinue()
        if (shouldContinue) {
          totalIterations = 0
          continue
        }
      }
      break
    }
  }

  return fullText || lastChunk || "已达到最大迭代次数"
}
