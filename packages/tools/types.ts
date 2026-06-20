import { z } from 'zod'
import type { ToolContext } from './context'

export const ToolResultSchema = <T extends z.ZodTypeAny>(outputSchema: T) =>
  z.object({
    success: z.boolean(),
    output: outputSchema.optional(),
    error: z.string().optional(),
  })

export type ToolResult<T = unknown> = {
  success: boolean
  output?: T
  error?: string
}

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: z.ZodTypeAny
  outputSchema?: z.ZodTypeAny
  maxOutputTokens?: number
  handler: (input: any, ctx: ToolContext) => Promise<ToolResult<any>>
}

export type ToolName =
  | 'read' | 'write' | 'edit' | 'glob' | 'grep'
  | 'bash' | 'skill' | 'webfetch' | 'websearch' | 'codesearch'
  | 'format' | 'lint' | 'database_query' | 'apply_patch'
