// 基础类型
export type SessionId = string & { readonly _brand: 'SessionId' }
export type UserId = string & { readonly _brand: 'UserId' }
export type MessageId = string & { readonly _brand: 'MessageId' }

// Effort Level
export type EffortLevel = 1 | 2 | 3 | 4 | 5

// Agent 类型
export type AgentType = 'primary' | 'subagent' | 'fork'

// 阶段
export type Phase = 'OBSERVE' | 'THINK' | 'PLAN' | 'BUILD' | 'EXECUTE' | 'VERIFY' | 'LEARN' | 'DONE'

// 配置
export interface Config {
  llm: LLMConfig
  security: SecurityConfig
  memory: MemoryConfig
  subagent: SubagentConfig
}

export interface LLMConfig {
  provider: 'anthropic' | 'openai' | 'local'
  model: string
  apiKeyEnv?: string
  apiKey?: string
  baseUrl?: string
}

export interface SecurityConfig {
  commandWhitelist: string[]
  allowedPaths: string[]
  deniedPaths: string[]
}

export interface MemoryConfig {
  path: string
  retentionDays: number
}

export interface SubagentConfig {
  maxConcurrent: number
  maxDepth: number
  timeoutMs: number
  blockedTools: string[]
}
