import type { AgentType, SessionId } from '../core/types'

export interface Agent {
  id: string
  type: AgentType
  parentId?: string
  depth: number
  sessionId: SessionId
  tools: string[]
  blockedTools: string[]
  createdAt: number
}

export interface SpawnInput {
  mode: AgentType
  parentId?: string
  task: string
  context: 'full' | 'minimal' | 'fork'
  tools: string[] | 'inherit'
  timeoutMs?: number
}
