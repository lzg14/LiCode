export const SUBAGENT_BLOCKED_TOOLS = [
    'delegate_task',
    'clarify',
    'memory_write',
    'send_message',
    'execute_code',
];
export function isBlockedTool(tool) {
    return SUBAGENT_BLOCKED_TOOLS.includes(tool);
}
