import { z } from 'zod';
export const LLMConfigSchema = z.object({
    provider: z.enum(['anthropic', 'openai', 'local']),
    model: z.string(),
    apiKeyEnv: z.string().optional(),
    apiKey: z.string().optional(), // 直接传入的 API key
    baseUrl: z.string().optional(), // 自定义端点
});
export const SecurityConfigSchema = z.object({
    commandWhitelist: z.array(z.string()),
    allowedPaths: z.array(z.string()),
    deniedPaths: z.array(z.string()),
});
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
});
export const MemoryConfigSchema = z.object({
    path: z.string(),
    retentionDays: z.number().default(30),
});
export const ConfigSchema = z.object({
    llm: LLMConfigSchema,
    security: SecurityConfigSchema,
    memory: MemoryConfigSchema,
    subagent: SubagentConfigSchema,
});
