import { MCPIntegration, type MCPTool, type MCPToolCallResult } from './mcp'

/**
 * MCP 工具适配器 - 工具发现、注册、调用代理
 */

export interface MCPToolAdapterConfig {
  autoDiscover?: boolean
  cacheTools?: boolean
  callTimeout?: number
}

export interface RegisteredTool {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
  serverId: string
  integration: MCPIntegration
}

export interface ToolCallRequest {
  name: string
  arguments?: Record<string, unknown>
  serverId?: string
}

export interface ToolCallResponse {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>
  isError?: boolean
  serverId: string
  toolName: string
}

export class MCPToolAdapter {
  private tools = new Map<string, RegisteredTool>()
  private config: MCPToolAdapterConfig
  private integrations = new Map<string, MCPIntegration>()

  constructor(config: MCPToolAdapterConfig = {}) {
    this.config = {
      autoDiscover: true,
      cacheTools: true,
      callTimeout: 30000,
      ...config,
    }
  }

  registerIntegration(id: string, integration: MCPIntegration): void {
    this.integrations.set(id, integration)
  }

  unregisterIntegration(id: string): void {
    this.integrations.delete(id)
    for (const [name, tool] of this.tools) {
      if (tool.serverId === id) {
        this.tools.delete(name)
      }
    }
  }

  async discoverTools(integrationId: string): Promise<MCPTool[]> {
    const integration = this.integrations.get(integrationId)
    if (!integration) throw new Error(`Integration ${integrationId} not found`)

    const tools = await integration.discoverTools()

    if (this.config.cacheTools) {
      for (const tool of tools) {
        this.tools.set(tool.name, {
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          serverId: integrationId,
          integration,
        })
      }
    }

    return tools
  }

  async discoverAllTools(): Promise<MCPTool[]> {
    const allTools: MCPTool[] = []
    for (const [id, integration] of this.integrations) {
      try {
        const tools = await this.discoverTools(id)
        allTools.push(...tools)
      } catch (error) {
        console.error(`[MCP] Failed to discover tools from ${id}:`, error)
      }
    }
    return allTools
  }

  getRegisteredTools(): RegisteredTool[] {
    return Array.from(this.tools.values())
  }

  getToolByName(name: string): RegisteredTool | undefined {
    return this.tools.get(name)
  }

  getToolsByServer(serverId: string): RegisteredTool[] {
    return Array.from(this.tools.values()).filter(t => t.serverId === serverId)
  }

  searchTools(query: string): RegisteredTool[] {
    const lowerQuery = query.toLowerCase()
    return Array.from(this.tools.values()).filter(tool =>
      tool.name.toLowerCase().includes(lowerQuery) ||
      tool.description?.toLowerCase().includes(lowerQuery)
    )
  }

  async callTool(request: ToolCallRequest): Promise<ToolCallResponse> {
    const tool = this.tools.get(request.name)
    if (!tool) throw new Error(`Tool ${request.name} not found`)

    const serverId = request.serverId || tool.serverId
    const integration = this.integrations.get(serverId) || tool.integration

    const result = await Promise.race([
      integration.callTool(request.name, request.arguments || {}),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Tool call timeout after ${this.config.callTimeout}ms`)), this.config.callTimeout)
      ),
    ])

    return {
      content: result.content,
      isError: result.isError,
      serverId,
      toolName: request.name,
    }
  }

  async callToolByName(name: string, args?: Record<string, unknown>, serverId?: string): Promise<ToolCallResponse> {
    return this.callTool({ name, arguments: args, serverId })
  }

  async batchCallTool(requests: ToolCallRequest[]): Promise<ToolCallResponse[]> {
    return Promise.all(requests.map(req => this.callTool(req)))
  }

  clearCache(): void {
    this.tools.clear()
  }

  getToolSchema(name: string): Record<string, unknown> | undefined {
    const tool = this.tools.get(name)
    return tool?.inputSchema
  }

  validateArguments(name: string, args: Record<string, unknown>): { valid: boolean; errors: string[] } {
    const tool = this.tools.get(name)
    if (!tool) return { valid: false, errors: [`Tool ${name} not found`] }

    const schema = tool.inputSchema as { required?: string[]; properties?: Record<string, unknown> } | undefined
    if (!schema) return { valid: true, errors: [] }

    const errors: string[] = []

    if (schema.required) {
      for (const field of schema.required) {
        if (!(field in args)) {
          errors.push(`Missing required field: ${field}`)
        }
      }
    }

    return { valid: errors.length === 0, errors }
  }
}

export function createMCPToolAdapter(config?: MCPToolAdapterConfig): MCPToolAdapter {
  return new MCPToolAdapter(config)
}
