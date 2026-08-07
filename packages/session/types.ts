export type SessionStatus = 'idle' | 'running' | 'blocked' | 'completed' | 'failed'

export type PartType = 'text' | 'tool-call' | 'tool-result' | 'reasoning' | 'file'

export interface Session {
  id: string
  title: string
  directory: string
  parentId?: string
  contextFrom?: string
  contextWatermark?: string
  status: SessionStatus
  model?: string
  provider?: string
  tokenUsage?: { input: number; output: number; total: number }
  cost?: number
  summary?: { additions: number; deletions: number; files: string[] }
  lastCheckpointMessageId?: string
  createdAt: number
  updatedAt: number
  completedAt?: number
}

export interface Message {
  id: string
  sessionId: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  agent?: string
  model?: string
  tokenUsage?: { input: number; output: number; reasoning?: number }
  cost?: number
  /** 父消息 ID（用于消息级分支） */
  parentId?: string
  createdAt: number
}

export interface Part {
  id: string
  messageId: string
  type: PartType
  content: string
  toolName?: string
  toolCallId?: string
  args?: Record<string, unknown>
  result?: string
  metadata?: Record<string, unknown>
  createdAt: number
}

export interface SessionSummary {
  additions: number
  deletions: number
  files: string[]
}
