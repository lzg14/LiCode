import { type ImagePart, type TextPart, type Tool, jsonSchema, tool } from "ai"
import { globalToolRegistry } from "../../../tools/registry"
import { buildProjectRole, detectProject } from "../../detect-project"
import { devLogger } from "../../dev-logger"
import { SubagentManager } from "../../subagent"
import { zodToJsonSchema } from "../../utils"
import {
  IntelligenceAdapter,
  defaultRegistry,
} from "../../intelligence"
import type { ExecuteContext, MessageContent } from "./context"
import { SYSTEM_PROMPT } from "./prompts"
import { loadProjectConfig } from "./load-config"
import { findValidStart } from "./helpers"
import { SkillStack } from "../../../skills/stack"
import { callLLM, type LLMResult } from "../../llm-client"
import { executeToolBatch } from "../../tool-executor"

const MAX_ITERATIONS = 100

// v2 §4.M5: 决策整合 adapter（per-execute 实例，避免跨 session 污染）
const intelligenceAdapter = new IntelligenceAdapter({ registry: defaultRegistry() })

// ─── 构建 system prompt ─────────────────────────────────
//
// v2 §4.M5: 追加 augmentedPrompt.systemHints（来自 M5 adapter beforeExecute）
// 顺序：SYSTEM_PROMPT → projectConfig → activeSkill → intelligenceAdapter hints

export function buildSystem(
  ctx: ExecuteContext,
  projectConfig: string,
  intelligenceHints: string,
): string {
  const projectInfo = detectProject(ctx.cwd ?? process.cwd())
  const projectRole = buildProjectRole(projectInfo)
  let sys = SYSTEM_PROMPT.replace('你是一个名为 licode 的 AI 助手，专注于代码开发。', projectRole)
  if (projectConfig) sys += `\n\n## 项目配置\n\n${projectConfig}`
  // 多 skill 栈注入（优先）— 使用 SkillStack.toPromptString() 避免重复渲染逻辑
  if (ctx.skillStack && ctx.skillStack.length > 0) {
    const stack = new SkillStack()
    for (const item of ctx.skillStack) {
      stack.push(item.skill, item.role, item.instructions)
    }
    sys += `\n\n${stack.toPromptString()}`
  } else if (ctx.activeSkillInstructions) {
    // 单 skill 模式（兼容）
    sys += `\n\n## 当前激活技能: ${ctx.activeSkill ?? "?"}\n\n${ctx.activeSkillInstructions}\n\n请严格遵循上述技能的指令与规则。`
  }
  // 注入可用 skill 元数据（只注入索引，按需 read 加载全文）
  if (ctx.availableSkills && ctx.availableSkills.length > 0) {
    sys += `\n\n## 可用技能\n\n以下技能可通过 \`skill\` 工具激活。当用户任务匹配触发条件时，应先激活对应技能再执行。\n注：技能详细指令请用 read 工具读取对应的 SKILL.md 文件（路径见下表）。\n\n`
    sys += `| 技能 | 描述 | 何时用 | 路径 |\n|------|------|--------|------|\n`
    for (const s of ctx.availableSkills) {
      const hints = s.triggerHints || '-'
      const path = s.path || '-'
      sys += `| ${s.name} | ${s.description || '-'} | ${hints} | ${path} |\n`
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
