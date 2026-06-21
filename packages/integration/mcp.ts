import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { BaseIntegration, type HealthStatus } from './types'

/**
 * MCP 集成 - 使用 @modelcontextprotocol/sdk
 */

export interface MCPConfig {
  command: string
  args?: string[]
  env?: Record<string, string>
  timeout?: number
}

export interface MCPTool {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
  annotations?: Record<string, unknown>
}

export interface MCPToolCallResult {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>
  isError?: boolean
}

export interface MCPResource {
  uri: string
  name: string
  description?: string
  mimeType?: string
}

export interface MCPPrompt {
  name: string
  description?: string
  arguments?: Array<{
    name: string
    description?: string
    required?: boolean
  }>
}

export class MCPIntegration extends BaseIntegration {
  name = 'mcp'
  private config: MCPConfig
  private client: Client
  private transport: StdioClientTransport | null = null
  private tools = new Map<string, MCPTool>()
  private resources = new Map<string, MCPResource>()
  private prompts = new Map<string, MCPPrompt>()
  private serverInfo?: { name: string; version: string }

  constructor(config: MCPConfig) {
    super()
    this.config = {
      timeout: 30000,
      ...config,
    }
    this.client = new Client({
      name: 'licode',
      version: '0.2.0',
    })
  }

  async connect(): Promise<void> {
    this.transport = new StdioClientTransport({
      command: this.config.command,
      args: this.config.args,
      env: { ...process.env, ...this.config.env } as Record<string, string>,
    })

    await this.client.connect(this.transport)
    this.enabled = true

    const serverCapabilities = this.client.getServerCapabilities()
    if (serverCapabilities) {
      this.serverInfo = this.client.getServerVersion() ?? undefined
    }
  }

  async disconnect(): Promise<void> {
    await this.client.close()
    this.enabled = false
    this.tools.clear()
    this.resources.clear()
    this.prompts.clear()
  }

  async health(): Promise<HealthStatus> {
    if (!this.enabled) {
      return { healthy: false, message: 'MCP not connected' }
    }
    try {
      const start = Date.now()
      await this.client.ping()
      return { healthy: true, latency: Date.now() - start }
    } catch {
      return { healthy: false, message: 'MCP ping failed' }
    }
  }

  getServerInfo(): { name: string; version: string } | undefined {
    return this.serverInfo
  }

  async discoverTools(): Promise<MCPTool[]> {
    return this.withConnection(async () => {
      const response = await this.client.listTools()
      const tools: MCPTool[] = response.tools.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as Record<string, unknown>,
        annotations: t.annotations as Record<string, unknown> | undefined,
      }))
      this.tools.clear()
      for (const tool of tools) {
        this.tools.set(tool.name, tool)
      }
      return tools
    })
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<MCPToolCallResult> {
    return this.withConnection(async () => {
      const response = await this.client.callTool({ name, arguments: args })
      return {
        content: response.content as Array<{ type: string; text?: string; [key: string]: unknown }>,
        isError: response.isError as boolean | undefined,
      }
    })
  }

  async discoverResources(): Promise<MCPResource[]> {
    return this.withConnection(async () => {
      const response = await this.client.listResources()
      const resources: MCPResource[] = response.resources.map(r => ({
        uri: r.uri,
        name: r.name,
        description: r.description,
        mimeType: r.mimeType,
      }))
      this.resources.clear()
      for (const resource of resources) {
        this.resources.set(resource.uri, resource)
      }
      return resources
    })
  }

  async readResource(uri: string): Promise<{ contents: Array<{ uri: string; mimeType?: string; text?: string }> }> {
    return this.withConnection(async () => {
      const response = await this.client.readResource({ uri })
      return { contents: response.contents as Array<{ uri: string; mimeType?: string; text?: string }> }
    })
  }

  async discoverPrompts(): Promise<MCPPrompt[]> {
    return this.withConnection(async () => {
      const response = await this.client.listPrompts()
      const prompts: MCPPrompt[] = response.prompts.map(p => ({
        name: p.name,
        description: p.description,
        arguments: p.arguments,
      }))
      this.prompts.clear()
      for (const prompt of prompts) {
        this.prompts.set(prompt.name, prompt)
      }
      return prompts
    })
  }

  async getPrompt(name: string, args?: Record<string, string>): Promise<{ messages: Array<{ role: string; content: unknown }> }> {
    return this.withConnection(async () => {
      const response = await this.client.getPrompt({ name, arguments: args })
      return { messages: response.messages as Array<{ role: string; content: unknown }> }
    })
  }

  getTools(): MCPTool[] {
    return Array.from(this.tools.values())
  }

  getTool(name: string): MCPTool | undefined {
    return this.tools.get(name)
  }

  getResources(): MCPResource[] {
    return Array.from(this.resources.values())
  }

  getPrompts(): MCPPrompt[] {
    return Array.from(this.prompts.values())
  }

  async withConnection<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.enabled) {
      throw new Error('MCP not connected')
    }
    return fn()
  }
}

export function createMCP(config: MCPConfig): MCPIntegration {
  return new MCPIntegration(config)
}
