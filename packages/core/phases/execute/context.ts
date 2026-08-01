import type { LanguageModel } from "ai"
import type { ImagePart, TextPart } from "@ai-sdk/provider-utils"
import type { SessionManager } from "../../../session/session"
import type { Memory } from "../../../memory/memory"
import type { Timer } from "../../perf"
import type { SkillIndex } from "../../../skills/types"

import type { ToolCallPart, ToolResultPart } from "@ai-sdk/provider-utils"

export type MessageContent = TextPart | ImagePart | ToolCallPart | ToolResultPart

/** 内部消息格式兼容 AI SDK */
type InternalMessage = { role: string; content: MessageContent[] }

export interface ExecuteContext {
  model: LanguageModel
  userInput: string
  userImages?: Array<{ base64: string; mimeType: string }>
  cwd?: string
  signal?: AbortSignal
  onLLMCall?: () => void
  onLLMResult?: (usage: { inputTokens: number; outputTokens: number; totalTokens: number }) => void
  onStreamText?: (text: string) => void
  onToolCall?: (toolName: string, args: Record<string, unknown>, batch: number) => void
  onToolResult?: (result: unknown) => void
  onSubagentStart?: (id: string, task: string) => void
  onSubagentEnd?: (id: string, success: boolean) => void
  onIntermediateText?: (text: string) => void
  onConfirmContinue?: () => Promise<boolean>
  history?: Array<{ role: string; content: MessageContent[] }>
  sessionSummary?: string
  sessionId?: string
  sessionManager?: SessionManager
  activeSkill?: string | null
  activeSkillInstructions?: string | null
  /** 所有可用 skill 的索引信息（用于 system prompt 注入） */
  availableSkills?: SkillIndex[]
  timer?: Timer
  /** v2 智能增强 §4.M5: Memory 实例（adpter 读写 M4 schema 用） */
  memory?: Memory
  /** v2 智能增强 §4.M5: 模型信息（adpter 调试 / metrics 用） */
  modelInfo?: { modelId: string; provider: string }
}
