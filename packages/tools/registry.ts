import type { ToolDefinition, ToolResult } from './types'

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>()

  register<T>(tool: ToolDefinition<T>): void {
    this.tools.set(tool.name, tool as ToolDefinition)
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name)
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values())
  }

  async execute(name: string, input: unknown): Promise<ToolResult> {
    const tool = this.tools.get(name)
    if (!tool) {
      return { success: false, error: `Tool not found: ${name}` }
    }

    try {
      const result = await tool.handler(input)
      return result as ToolResult
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }
}

export const globalToolRegistry = new ToolRegistry()
