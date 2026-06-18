import { spawn, type ChildProcess } from 'child_process'
import { BaseIntegration, type HealthStatus } from './types'

/**
 * MCP 集成 - Model Context Protocol 服务器连接、工具发现、工具调用
 */

export interface MCPConfig {
  /** 服务器命令 */
  command: string
  /** 命令参数 */
  args?: string[]
  /** 环境变量 */
  env?: Record<string, string>
  /** 连接超时（毫秒） */
  timeout?: number
  /** 安全配置 */
  security?: MCPSecurityConfig
}

export interface MCPSecurityConfig {
  /** 自动批准本地工具调用 */
  auto_approve_local?: boolean
  /** 要求工具清单文件 */
  require_manifest?: boolean
  /** 阻止外部网络调用 */
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

export class MCPIntegration extends BaseIntegration {
  name = 'mcp'
  private config: MCPConfig
  private process: ChildProcess | null = null
  private tools = new Map<string, MCPTool>()
  private requestId = 0
  private pendingRequests = new Map<number, { resolve: (value: unknown) => void; reject: (reason: unknown) => void }>()
  private buffer = ''

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

        this.process.on('close', (code) => {
          this.enabled = false
          this.process = null
        })

        this.process.stdout?.on('data', (data: Buffer) => {
          this.handleData(data.toString())
        })

        this.process.stderr?.on('data', (data: Buffer) => {
          console.error(`[MCP] stderr: ${data}`)
        })

        this.sendRequest('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          clientInfo: { name: 'licode', version: '0.1.0' },
        }).then((response: unknown) => {
          const result = response as { capabilities?: { tools?: unknown } }
          if (result?.capabilities?.tools) {
            this.enabled = true
            clearTimeout(timer)
            resolve()
          } else {
            clearTimeout(timer)
            reject(new Error('MCP server does not support tools'))
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
    this.tools.clear()
    this.pendingRequests.clear()
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

  /**
   * 发现服务器提供的工具
   */
  async discoverTools(): Promise<MCPTool[]> {
    return this.withConnection(async () => {
      const response = await this.sendRequest('tools/list', {}) as { tools?: MCPTool[] }
      const tools = response?.tools || []
      this.tools.clear()
      for (const tool of tools) {
        this.tools.set(tool.name, tool)
      }
      return tools
    })
  }

  /**
   * 调用工具
   */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<MCPToolCallResult> {
    return this.withConnection(async () => {
      this.validateSecurity(name, args)
      const response = await this.sendRequest('tools/call', { name, arguments: args }) as MCPToolCallResult
      return response
    })
  }

  /**
   * 获取已发现的工具列表
   */
  getTools(): MCPTool[] {
    return Array.from(this.tools.values())
  }

  /**
   * 获取指定工具
   */
  getTool(name: string): MCPTool | undefined {
    return this.tools.get(name)
  }

  /**
   * 安全校验
   */
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

  /**
   * 发送 JSON-RPC 请求
   */
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

  /**
   * 处理接收到的数据
   */
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
          }
        } catch (e) {
          console.error('[MCP] Failed to parse message:', line, e)
        }
      }
    }
  }
}

/**
 * 创建 MCP 集成实例
 */
export function createMCP(config: MCPConfig): MCPIntegration {
  return new MCPIntegration(config)
}
