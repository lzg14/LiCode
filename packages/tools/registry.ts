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

// 注册默认的安全检查 hook
globalToolRegistry.addPreExecuteHook((name, input) => {
  // bash: 危险命令检查（rm -rf / sudo 等）
  if (name === 'bash') {
    try {
      const parsed = JSON.parse(JSON.stringify(input))
      const command = parsed?.command
      if (typeof command === 'string') {
        const { checkDangerousPattern } = require('../security')
        const dangerous = checkDangerousPattern(command)
        if (dangerous.dangerous) {
          return { allowed: false, reason: dangerous.reason }
        }
        const { securityLayer } = require('../security')
        const check = securityLayer.checkCommand(command)
        if (!check.allowed) {
          return { allowed: false, reason: check.reason }
        }
      }
    } catch {}
  }

  // write/edit/delete_file/apply_patch/move_file/copy_file: 路径检查
  const pathTools = ['write', 'edit', 'delete_file', 'apply_patch', 'move_file', 'copy_file']
  if (pathTools.includes(name)) {
    try {
      const parsed = JSON.parse(JSON.stringify(input))
      const path = parsed?.path ?? parsed?.filePath ?? parsed?.source
      if (typeof path === 'string') {
        const { securityLayer } = require('../security')
        const check = securityLayer.checkPath(path)
        if (!check.allowed) {
          return { allowed: false, reason: check.reason }
        }
      }
    } catch {}
  }

  return null
})
