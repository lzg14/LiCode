import type { LanguageModel } from "ai"
import type { TextPart, ToolCallPart, ToolResultPart } from "@ai-sdk/provider-utils"
import type { SessionManager } from "../../../session/session"
import type { Timer } from "../../perf"

export type MessageContent = TextPart | ToolCallPart | ToolResultPart

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
  onIntermediateText?: (text: string) => void
  onConfirmContinue?: () => Promise<boolean>
  history?: Array<{ role: string; content: MessageContent[] }>
  sessionSummary?: string
  sessionId?: string
  sessionManager?: SessionManager
  activeSkill?: string | null
  activeSkillInstructions?: string | null
  timer?: Timer
}
