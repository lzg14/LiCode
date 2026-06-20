import { z } from 'zod'

export const PROVIDERS = ['anthropic', 'openai', 'deepseek', 'local'] as const

export const MODEL_CATALOG: Record<string, string[]> = {
  anthropic: ['claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'],
  deepseek: ['deepseek-v4-flash', 'deepseek-chat', 'deepseek-coder'],
  local: ['codellama', 'llama3', 'qwen2'],
}

export const LLMConfigSchema = z.object({
  provider: z.enum(PROVIDERS),
  model: z.string(),
  apiKeyEnv: z.string().optional(),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
})

export const SecurityConfigSchema = z.object({
  commandWhitelist: z.array(z.string()),
  allowedPaths: z.array(z.string()),
  deniedPaths: z.array(z.string()),
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

export const ConfigSchema = z.object({
  llm: LLMConfigSchema,
  security: SecurityConfigSchema,
  memory: MemoryConfigSchema,
  subagent: SubagentConfigSchema,
})

export type Config = z.infer<typeof ConfigSchema>
