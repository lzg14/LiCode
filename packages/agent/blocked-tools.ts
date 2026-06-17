export const SUBAGENT_BLOCKED_TOOLS = [
  'delegate_task',
  'clarify',
  'memory_write',
  'send_message',
  'execute_code',
] as const

export function isBlockedTool(tool: string): boolean {
  return SUBAGENT_BLOCKED_TOOLS.includes(tool as any)
}
