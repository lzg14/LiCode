import type { ToolDefinition, ToolResult } from './types'
import type { ToolContext } from './context'
import { createToolContext } from './context'
import { truncateOutput } from './truncate'
import { securityLayer } from '../security'

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>()
  private defaultContext: ToolContext

  constructor(defaultContext?: Partial<ToolContext>) {
    this.defaultContext = createToolContext(defaultContext)
  }

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool)
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name)
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values())
  }

  async execute(
    name: string,
    input: unknown,
    ctx?: Partial<ToolContext>,
  ): Promise<ToolResult> {
    const tool = this.tools.get(name)
    if (!tool) {
      return { success: false, error: `Tool not found: ${name}` }
    }

    // 安全检查：bash 工具需要检查命令白名单
    if (name === 'bash') {
      const parsed = tool.inputSchema.parse(input) as { command?: string }
      if (parsed.command) {
        const check = securityLayer.checkCommand(parsed.command)
        if (!check.allowed) {
          return { success: false, error: `安全拦截: ${check.reason}` }
        }
      }
    }

    const mergedCtx = { ...this.defaultContext, ...ctx }

    try {
      const parsedInput = tool.inputSchema.parse(input)
      const result = await tool.handler(parsedInput, mergedCtx)

      if (result.output && typeof result.output === 'string') {
        const maxChars = tool.maxOutputTokens
          ? tool.maxOutputTokens * 4
          : 50_000
        result.output = truncateOutput(result.output, maxChars)
      }

      if (result.success && tool.outputSchema) {
        tool.outputSchema.parse(result.output)
      }

      return result
    } catch (error) {
      if (error instanceof Error && error.name === 'ZodError') {
        return { success: false, error: `Input validation failed: ${error.message}` }
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }
}

export const globalToolRegistry = new ToolRegistry()
