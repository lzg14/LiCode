import type { z } from 'zod'
import type { AgentType, SessionId } from '../core/types'

export interface Agent {
  id: string
  type: AgentType
  parentId?: string
  depth: number
  sessionId: SessionId
  tools: string[]
  blockedTools: string[]
  status: 'idle' | 'running' | 'blocked' | 'completed' | 'failed'
  createdAt: number
  completedAt?: number
}

export interface SpawnInput {
  mode: AgentType
  parentId?: string
  task: string
  description?: string
  context: 'full' | 'minimal' | 'fork'
  tools: string[] | 'inherit'
  model?: { provider: string; model: string }
  background: boolean
  task_id?: string
  cwd?: string
  timeoutMs?: number
}

export interface AgentOutcome {
  status: 'success' | 'partial' | 'failed' | 'blocked'
  finalText?: string
  error?: string
  duration?: number
}

export interface ForkContext {
  parentAgentId: string
  childAgentId: string
  sharedState: Record<string, unknown>
  inheritTools: boolean
  inheritSession: boolean
  createdAt: number
}

export interface StructuredOutput<T = unknown> {
  status: 'success' | 'partial' | 'failed' | 'blocked'
  summary?: string
  data?: T
  error?: string
  metadata?: Record<string, unknown>
}

export type TaskStatus = 'pending' | 'in_progress' | 'blocked' | 'done' | 'abandoned'

export interface TaskEvent {
  taskId: string
  type: 'created' | 'started' | 'blocked' | 'unblocked' | 'completed' | 'failed' | 'abandoned' | 'renamed'
  timestamp: number
  detail?: string
  previousStatus?: TaskStatus
  newStatus?: TaskStatus
}

export interface Task {
  id: string
  summary: string
  parentId?: string
  status: TaskStatus
  events: TaskEvent[]
  createdAt: number
  updatedAt: number
  completedAt?: number
  result?: AgentOutcome
}

export interface OutputSchema {
  name: string
  schema: z.ZodType
  description?: string
}

export const SUBAGENT_BLOCKED_TOOLS = [
  'delegate_task',
  'question',
  'memory',
  'send_message',
]

export const AGENT_TYPES: Record<string, { type: AgentType; description: string; tools?: string[] }> = {
  build: {
    type: 'primary',
    description: '主执行 Agent，直接与用户交互',
  },
  plan: {
    type: 'primary',
    description: '只读计划模式',
    tools: ['read', 'glob', 'grep', 'bash'],
  },
  explore: {
    type: 'subagent',
    description: '代码探索，快速搜索文件和内容',
    tools: ['read', 'glob', 'grep', 'bash'],
  },
  compaction: {
    type: 'subagent',
    description: '上下文压缩，减少 token 消耗',
  },
  dream: {
    type: 'subagent',
    description: '创意生成，头脑风暴',
  },
  distill: {
    type: 'subagent',
    description: '内容提炼，总结关键信息',
  },
}
