export interface ToolContext {
  sessionId: string
  agentId: string
  cwd: string
  env: Record<string, string | undefined>
  timeout?: number
  abortSignal?: AbortSignal
  metadata?: Record<string, unknown>
}

export function createToolContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    sessionId: overrides.sessionId ?? crypto.randomUUID(),
    agentId: overrides.agentId ?? 'default',
    cwd: overrides.cwd ?? process.cwd(),
    env: overrides.env ?? { ...process.env },
    timeout: overrides.timeout ?? 30_000,
    ...overrides,
  }
}
