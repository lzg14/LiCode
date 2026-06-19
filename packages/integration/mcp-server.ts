import { MCPIntegration, type MCPConfig } from './mcp'

/**
 * MCP 服务器管理 - 连接池、健康检查、自动重连
 */

export interface MCPServerConfig extends MCPConfig {
  id: string
  name?: string
  maxRetries?: number
  retryDelay?: number
  healthCheckInterval?: number
}

export interface MCPServerStatus {
  id: string
  name: string
  connected: boolean
  healthy: boolean
  latency?: number
  lastHealthCheck?: Date
  error?: string
}

interface PoolEntry {
  integration: MCPIntegration
  config: MCPServerConfig
  status: MCPServerStatus
  retryCount: number
  healthTimer?: ReturnType<typeof setInterval>
}

export class MCPServerManager {
  private servers = new Map<string, PoolEntry>()
  private globalHealthTimer?: ReturnType<typeof setInterval>

  async addServer(config: MCPServerConfig): Promise<MCPIntegration> {
    if (this.servers.has(config.id)) {
      throw new Error(`Server ${config.id} already exists`)
    }

    const integration = new MCPIntegration(config)
    const entry: PoolEntry = {
      integration,
      config,
      status: {
        id: config.id,
        name: config.name || config.id,
        connected: false,
        healthy: false,
      },
      retryCount: 0,
    }

    this.servers.set(config.id, entry)

    try {
      await integration.connect()
      entry.status.connected = true
      entry.status.healthy = true
      entry.retryCount = 0
    } catch (error) {
      entry.status.error = (error as Error).message
      entry.retryCount++
    }

    if (config.healthCheckInterval && config.healthCheckInterval > 0) {
      entry.healthTimer = setInterval(() => {
        this.checkHealth(config.id)
      }, config.healthCheckInterval)
    }

    return integration
  }

  async removeServer(id: string): Promise<void> {
    const entry = this.servers.get(id)
    if (!entry) return

    if (entry.healthTimer) {
      clearInterval(entry.healthTimer)
    }

    await entry.integration.disconnect()
    this.servers.delete(id)
  }

  async connectServer(id: string): Promise<void> {
    const entry = this.servers.get(id)
    if (!entry) throw new Error(`Server ${id} not found`)

    try {
      await entry.integration.connect()
      entry.status.connected = true
      entry.status.healthy = true
      entry.status.error = undefined
      entry.retryCount = 0
    } catch (error) {
      entry.status.connected = false
      entry.status.healthy = false
      entry.status.error = (error as Error).message
      entry.retryCount++
      throw error
    }
  }

  async disconnectServer(id: string): Promise<void> {
    const entry = this.servers.get(id)
    if (!entry) throw new Error(`Server ${id} not found`)

    await entry.integration.disconnect()
    entry.status.connected = false
    entry.status.healthy = false
  }

  async reconnectServer(id: string): Promise<void> {
    const entry = this.servers.get(id)
    if (!entry) throw new Error(`Server ${id} not found`)

    const maxRetries = entry.config.maxRetries || 3
    const retryDelay = entry.config.retryDelay || 1000

    await entry.integration.disconnect()
    entry.status.connected = false
    entry.status.healthy = false

    for (let i = 0; i < maxRetries; i++) {
      try {
        await entry.integration.connect()
        entry.status.connected = true
        entry.status.healthy = true
        entry.status.error = undefined
        entry.retryCount = 0
        return
      } catch (error) {
        entry.retryCount++
        entry.status.error = (error as Error).message
        if (i < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, retryDelay * (i + 1)))
        }
      }
    }

    throw new Error(`Failed to reconnect server ${id} after ${maxRetries} attempts`)
  }

  getServer(id: string): MCPIntegration | undefined {
    return this.servers.get(id)?.integration
  }

  getServerStatus(id: string): MCPServerStatus | undefined {
    return this.servers.get(id)?.status
  }

  getAllServerStatus(): MCPServerStatus[] {
    return Array.from(this.servers.values()).map(e => e.status)
  }

  getConnectedServers(): MCPIntegration[] {
    return Array.from(this.servers.values())
      .filter(e => e.status.connected)
      .map(e => e.integration)
  }

  getHealthyServers(): MCPIntegration[] {
    return Array.from(this.servers.values())
      .filter(e => e.status.connected && e.status.healthy)
      .map(e => e.integration)
  }

  async checkHealth(id: string): Promise<MCPServerStatus> {
    const entry = this.servers.get(id)
    if (!entry) throw new Error(`Server ${id} not found`)

    entry.status.lastHealthCheck = new Date()

    try {
      const result = await entry.integration.health()
      entry.status.healthy = result.healthy
      entry.status.latency = result.latency
      entry.status.error = result.healthy ? undefined : result.message
    } catch (error) {
      entry.status.healthy = false
      entry.status.error = (error as Error).message
    }

    return entry.status
  }

  async checkAllHealth(): Promise<MCPServerStatus[]> {
    const results: MCPServerStatus[] = []
    for (const id of this.servers.keys()) {
      results.push(await this.checkHealth(id))
    }
    return results
  }

  async autoReconnect(id: string): Promise<void> {
    const entry = this.servers.get(id)
    if (!entry || !entry.config.maxRetries) return

    const maxRetries = entry.config.maxRetries
    const retryDelay = entry.config.retryDelay || 1000

    for (let i = 0; i < maxRetries; i++) {
      try {
        await entry.integration.connect()
        entry.status.connected = true
        entry.status.healthy = true
        entry.status.error = undefined
        entry.retryCount = 0
        return
      } catch {
        entry.retryCount++
        await new Promise(resolve => setTimeout(resolve, retryDelay * (i + 1)))
      }
    }
  }

  startGlobalHealthCheck(interval: number = 30000): void {
    this.stopGlobalHealthCheck()
    this.globalHealthTimer = setInterval(async () => {
      await this.checkAllHealth()
    }, interval)
  }

  stopGlobalHealthCheck(): void {
    if (this.globalHealthTimer) {
      clearInterval(this.globalHealthTimer)
      this.globalHealthTimer = undefined
    }
  }

  async shutdown(): Promise<void> {
    this.stopGlobalHealthCheck()
    for (const [id, entry] of this.servers) {
      if (entry.healthTimer) {
        clearInterval(entry.healthTimer)
      }
      try {
        await entry.integration.disconnect()
      } catch {}
    }
    this.servers.clear()
  }
}

export function createMCPServerManager(): MCPServerManager {
  return new MCPServerManager()
}
