export type ToolName = 'read' | 'write' | 'edit' | 'glob' | 'grep' | 'bash' | 'skill'

export interface ToolDefinition<Input = unknown, Output = unknown> {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  handler: (input: Input) => Promise<ToolResult<Output>>
}

export interface ToolResult<T = unknown> {
  success: boolean
  output?: T
  error?: string
}
