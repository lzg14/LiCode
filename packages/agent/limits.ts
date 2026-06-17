export interface AgentLimits {
  maxConcurrent: number
  maxDepth: number
  timeoutMs: number
}

export const DEFAULT_LIMITS: AgentLimits = {
  maxConcurrent: 3,
  maxDepth: 1,
  timeoutMs: 900000,
}

class AgentLimitManager {
  private current = 0

  canSpawn(parentDepth: number): boolean {
    if (this.current >= DEFAULT_LIMITS.maxConcurrent) return false
    if (parentDepth >= DEFAULT_LIMITS.maxDepth) return false
    return true
  }

  spawn(): void {
    this.current++
  }

  terminate(): void {
    this.current = Math.max(0, this.current - 1)
  }

  getCurrent(): number {
    return this.current
  }
}

export const limitManager = new AgentLimitManager()
