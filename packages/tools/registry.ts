import type { ToolDefinition, ToolResult } from './types'
import type { ToolContext } from './context'
import { createToolContext } from './context'
import { truncateOutput } from './truncate'
import { securityLayer, checkDangerousPattern } from '../security'

export type PreExecuteHook = (
  name: string,
  input: unknown,
) => { allowed: boolean; reason?: string } | null | Promise<{ allowed: boolean; reason?: string } | null>

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>()
  private defaultContext: ToolContext
  private preExecuteHooks: PreExecuteHook[] = []

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

  addPreExecuteHook(hook: PreExecuteHook): void {
    this.preExecuteHooks.push(hook)
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

    // 执行 pre-execute hooks
    for (const hook of this.preExecuteHooks) {
      const result = await hook(name, input)
      if (result && !result.allowed) {
        return { success: false, error: `安全拦截: ${result.reason}` }
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

// 注册默认的 bash 安全检查 hook
globalToolRegistry.addPreExecuteHook((name, input) => {
  if (name === 'bash') {
    const parsed = input as { command?: string }
    if (parsed.command) {
      const check = securityLayer.checkCommand(parsed.command)
      if (!check.allowed) {
        return { allowed: false, reason: check.reason }
      }
    }
  }

  // write/edit/delete_file 路径检查
  if (name === 'write' || name === 'edit' || name === 'delete_file') {
    const parsed = input as { path?: string }
    if (parsed.path) {
      const check = securityLayer.checkPath(parsed.path)
      if (!check.allowed) {
        return { allowed: false, reason: check.reason }
      }
    }
  }

  return null
})
