// 基础类型
export type SessionId = string & { readonly _brand: 'SessionId' }
export type UserId = string & { readonly _brand: 'UserId' }
export type MessageId = string & { readonly _brand: 'MessageId' }

// Effort Level
export type EffortLevel = 1 | 2 | 3 | 4 | 5

// Agent 类型
export type AgentType = 'primary' | 'subagent' | 'fork'

// 阶段（简化：LLM 自己决定做什么，不再强制走流程）
export type Phase = 'EXECUTE' | 'DONE'

// 配置
export interface Config {
  llm: LLMConfig
  security: SecurityConfig
  memory: MemoryConfig
  subagent: SubagentConfig
  mcp?: { mcpServers?: Record<string, MCPConfig> }
  cwd?: string
}

export interface MCPConfig {
  command: string
  args?: string[]
  env?: Record<string, string>
  timeout?: number
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
