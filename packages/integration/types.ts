/**
 * 集成层 - Git 集成、LLM Provider 管理、插件系统
 */

export interface Integration {
  name: string
  enabled: boolean
  connect(): Promise<void>
  disconnect(): Promise<void>
  health(): Promise<HealthStatus>
}

export interface HealthStatus {
  healthy: boolean
  message?: string
  latency?: number
}

export abstract class BaseIntegration implements Integration {
  abstract name: string
  enabled = false

  abstract connect(): Promise<void>
  abstract disconnect(): Promise<void>
  abstract health(): Promise<HealthStatus>

  async withConnection<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.enabled) {
      throw new Error(`Integration ${this.name} is not connected`)
    }
    return fn()
  }
}
