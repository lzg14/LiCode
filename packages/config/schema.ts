import { z } from 'zod'

export const PROVIDERS = ['anthropic', 'openai', 'deepseek', 'MiniMax', 'local'] as const

export const LLMConfigSchema = z.object({
  provider: z.enum(PROVIDERS),
  model: z.string(),
  apiKeyEnv: z.string().optional(),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
})

export const SecurityConfigSchema = z.object({
  commandWhitelist: z.array(z.string()),
  blockedCommands: z.array(z.string()).optional(),
  allowedPaths: z.array(z.string()),
  deniedPaths: z.array(z.string()),
  maxFileSize: z.number().optional(),
  sensitivePatterns: z.array(z.string()).optional(),
})

export const SubagentConfigSchema = z.object({
  maxConcurrent: z.number().default(3),
  maxDepth: z.number().default(1),
  timeoutMs: z.number().default(900000),
  blockedTools: z.array(z.string()).default([
    'delegate_task',
    'clarify',
    'memory_write',
    'send_message',
    'execute_code',
  ]),
})

export const MemoryConfigSchema = z.object({
  path: z.string(),
  retentionDays: z.number().default(30),
})

export const MCPConfigSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  timeout: z.number().optional(),
})

export const ConfigSchema = z.object({
  llm: LLMConfigSchema,
  security: SecurityConfigSchema,
  memory: MemoryConfigSchema,
  subagent: SubagentConfigSchema,
  mcp: z.object({
    mcpServers: z.record(z.string(), MCPConfigSchema).optional(),
  }).optional(),
})

export type Config = z.infer<typeof ConfigSchema>
