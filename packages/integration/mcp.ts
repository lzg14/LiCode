import { spawn, type ChildProcess } from 'child_process'
import { BaseIntegration, type HealthStatus } from './types'

/**
 * MCP 集成 - Model Context Protocol 服务器连接、工具发现、工具调用
 */

export interface MCPConfig {
  command: string
  args?: string[]
  env?: Record<string, string>
  timeout?: number
  security?: MCPSecurityConfig
}

export interface MCPSecurityConfig {
  auto_approve_local?: boolean
  require_manifest?: boolean
  block_external?: boolean
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

export interface MCPServerCapabilities {
  tools?: Record<string, unknown>
  resources?: Record<string, unknown>
  prompts?: Record<string, unknown>
  logging?: Record<string, unknown>
}

export interface MCPInitializeResult {
  protocolVersion: string
  capabilities: MCPServerCapabilities
  serverInfo?: { name: string; version: string }
}

export class MCPIntegration extends BaseIntegration {
  name = 'mcp'
  private config: MCPConfig
  private process: ChildProcess | null = null
  private tools = new Map<string, MCPTool>()
  private resources = new Map<string, MCPResource>()
  private prompts = new Map<string, MCPPrompt>()
  private capabilities: MCPServerCapabilities = {}
  private requestId = 0
  private pendingRequests = new Map<number, { resolve: (value: unknown) => void; reject: (reason: unknown) => void }>()
  private notificationHandlers = new Map<string, (params: unknown) => void>()
  private buffer = ''
  private serverInfo?: { name: string; version: string }
  private initialized = false

  constructor(config: MCPConfig) {
    super()
    this.config = {
      timeout: 30000,
      security: {
        auto_approve_local: false,
        require_manifest: true,
        block_external: false,
      },
      ...config,
    }
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = this.config.timeout || 30000

      const timer = setTimeout(() => {
        reject(new Error(`MCP connection timeout after ${timeout}ms`))
      }, timeout)

      try {
        this.process = spawn(this.config.command, this.config.args || [], {
          env: { ...process.env, ...this.config.env },
          stdio: ['pipe', 'pipe', 'pipe'],
        })

        this.process.on('error', (error) => {
          clearTimeout(timer)
          this.enabled = false
          reject(error)
        })

        this.process.on('close', (_code) => {
          this.enabled = false
          this.process = null
          this.initialized = false
        })

        this.process.stdout?.on('data', (data: Buffer) => {
          this.handleData(data.toString())
        })

        this.process.stderr?.on('data', (data: Buffer) => {
          console.error(`[MCP] stderr: ${data}`)
        })

        this.sendRequest('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
            resources: {},
            prompts: {},
          },
          clientInfo: { name: 'licode', version: '0.1.0' },
        }).then((response: unknown) => {
          const result = response as MCPInitializeResult
          if (result?.capabilities) {
            this.capabilities = result.capabilities
            this.serverInfo = result.serverInfo
            this.initialized = true
            this.enabled = true
            clearTimeout(timer)

            this.sendNotification('notifications/initialized', {}).catch(() => {})
            resolve()
          } else {
            clearTimeout(timer)
            reject(new Error('MCP server returned invalid capabilities'))
          }
        }).catch((error) => {
          clearTimeout(timer)
          reject(error)
        })
      } catch (error) {
        clearTimeout(timer)
        reject(error)
      }
    })
  }

  async disconnect(): Promise<void> {
    if (this.process) {
      this.process.kill()
      this.process = null
    }
    this.enabled = false
    this.initialized = false
    this.tools.clear()
    this.resources.clear()
    this.prompts.clear()
    this.pendingRequests.clear()
    this.notificationHandlers.clear()
  }

  async health(): Promise<HealthStatus> {
    if (!this.enabled || !this.process) {
      return { healthy: false, message: 'MCP not connected' }
    }
    try {
      const start = Date.now()
      await this.sendRequest('ping', {})
      return { healthy: true, latency: Date.now() - start }
    } catch {
      return { healthy: false, message: 'MCP ping failed' }
    }
  }

  getServerInfo(): { name: string; version: string } | undefined {
    return this.serverInfo
  }

  getCapabilities(): MCPServerCapabilities {
    return this.capabilities
  }

  isInitialized(): boolean {
    return this.initialized
  }

  async discoverTools(): Promise<MCPTool[]> {
    return this.withConnection(async () => {
      if (!this.capabilities.tools) return []
      const response = await this.sendRequest('tools/list', {}) as { tools?: MCPTool[] }
      const tools = response?.tools || []
      this.tools.clear()
      for (const tool of tools) {
        this.tools.set(tool.name, tool)
      }
      return tools
    })
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<MCPToolCallResult> {
    return this.withConnection(async () => {
      this.validateSecurity(name, args)
      const response = await this.sendRequest('tools/call', { name, arguments: args }) as MCPToolCallResult
      return response
    })
  }

  async discoverResources(): Promise<MCPResource[]> {
    return this.withConnection(async () => {
      if (!this.capabilities.resources) return []
      const response = await this.sendRequest('resources/list', {}) as { resources?: MCPResource[] }
      const resources = response?.resources || []
      this.resources.clear()
      for (const resource of resources) {
        this.resources.set(resource.uri, resource)
      }
      return resources
    })
  }

  async readResource(uri: string): Promise<{ contents: Array<{ uri: string; mimeType?: string; text?: string; blob?: string }> }> {
    return this.withConnection(async () => {
      const response = await this.sendRequest('resources/read', { uri })
      return response as { contents: Array<{ uri: string; mimeType?: string; text?: string; blob?: string }> }
    })
  }

  async subscribeResource(uri: string): Promise<void> {
    return this.withConnection(async () => {
      await this.sendRequest('resources/subscribe', { uri })
    })
  }

  async unsubscribeResource(uri: string): Promise<void> {
    return this.withConnection(async () => {
      await this.sendRequest('resources/unsubscribe', { uri })
    })
  }

  async discoverPrompts(): Promise<MCPPrompt[]> {
    return this.withConnection(async () => {
      if (!this.capabilities.prompts) return []
      const response = await this.sendRequest('prompts/list', {}) as { prompts?: MCPPrompt[] }
      const prompts = response?.prompts || []
      this.prompts.clear()
      for (const prompt of prompts) {
        this.prompts.set(prompt.name, prompt)
      }
      return prompts
    })
  }

  async getPrompt(name: string, args?: Record<string, string>): Promise<{ messages: Array<{ role: string; content: unknown }> }> {
    return this.withConnection(async () => {
      const response = await this.sendRequest('prompts/get', { name, arguments: args || {} })
      return response as { messages: Array<{ role: string; content: unknown }> }
    })
  }

  onNotification(method: string, handler: (params: unknown) => void): void {
    this.notificationHandlers.set(method, handler)
  }

  removeNotificationHandler(method: string): void {
    this.notificationHandlers.delete(method)
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

  getResource(uri: string): MCPResource | undefined {
    return this.resources.get(uri)
  }

  getPrompts(): MCPPrompt[] {
    return Array.from(this.prompts.values())
  }

  getPromptByName(name: string): MCPPrompt | undefined {
    return this.prompts.get(name)
  }

  private validateSecurity(toolName: string, args: Record<string, unknown>): void {
    const security = this.config.security || {}
    const tool = this.tools.get(toolName)

    if (security.require_manifest && !tool) {
      throw new Error(`Tool ${toolName} not found in manifest`)
    }

    if (security.block_external) {
      const externalIndicators = ['http://', 'https://', 'ftp://', 'ssh://']
      const argsStr = JSON.stringify(args)
      for (const indicator of externalIndicators) {
        if (argsStr.includes(indicator)) {
          throw new Error(`External network calls blocked: ${indicator} detected in arguments`)
        }
      }
    }
  }

  private sendNotification(method: string, params: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin) {
        reject(new Error('MCP not connected'))
        return
      }

      const notification = {
        jsonrpc: '2.0',
        method,
        params,
      }

      const message = JSON.stringify(notification) + '\n'
      this.process.stdin.write(message, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  private sendRequest(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin) {
        reject(new Error('MCP not connected'))
        return
      }

      const id = ++this.requestId
      const request = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      }

      this.pendingRequests.set(id, { resolve, reject })

      const message = JSON.stringify(request) + '\n'
      this.process.stdin.write(message)
    })
  }

  private handleData(data: string): void {
    this.buffer += data
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() || ''

    for (const line of lines) {
      if (line.trim()) {
        try {
          const message = JSON.parse(line)

          if (message.id !== undefined && this.pendingRequests.has(message.id)) {
            const pending = this.pendingRequests.get(message.id)!
            this.pendingRequests.delete(message.id)
            if (message.error) {
              pending.reject(new Error(message.error.message || 'MCP request failed'))
            } else {
              pending.resolve(message.result)
            }
          } else if (message.method && !message.id) {
            const handler = this.notificationHandlers.get(message.method)
            if (handler) {
              handler(message.params)
            }
          }
        } catch (e) {
          console.error('[MCP] Failed to parse message:', line, e)
        }
      }
    }
  }
}

export function createMCP(config: MCPConfig): MCPIntegration {
  return new MCPIntegration(config)
}
