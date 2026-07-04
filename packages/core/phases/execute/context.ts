import type { Timer } from "../../perf"

export interface ExecuteContext {
  model: any
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
  history?: Array<{ role: string; content: any[] }>
  sessionSummary?: string
  sessionId?: string
  sessionManager?: any
  activeSkill?: string | null
  activeSkillInstructions?: string | null
  timer?: Timer
}
