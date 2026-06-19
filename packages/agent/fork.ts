import type { Agent, ForkContext, SpawnInput } from './types'
import { agentManager } from './manager'

export interface ForkOptions {
  inheritTools?: boolean
  inheritSession?: boolean
  sharedState?: Record<string, unknown>
  model?: { provider: string; model: string }
  timeoutMs?: number
}

export class ForkManager {
  private forks = new Map<string, ForkContext>()

  createFork(
    parentAgentId: string,
    task: string,
    options: ForkOptions = {},
  ): { agent: Agent; context: ForkContext } {
    const parent = agentManager.get(parentAgentId)
    if (!parent) {
      throw new Error(`Parent agent ${parentAgentId} not found`)
    }

    const inheritTools = options.inheritTools ?? true
    const inheritSession = options.inheritSession ?? false

    const spawnInput: SpawnInput = {
      mode: 'fork',
      parentId: parentAgentId,
      task,
      context: 'fork',
      tools: inheritTools ? parent.tools : [],
      background: false,
      model: options.model,
      timeoutMs: options.timeoutMs,
    }

    const child = agentManager.spawn(spawnInput, parent.depth)

    const context: ForkContext = {
      parentAgentId,
      childAgentId: child.id,
      sharedState: options.sharedState ?? {},
      inheritTools,
      inheritSession,
      createdAt: Date.now(),
    }

    this.forks.set(child.id, context)
    return { agent: child, context }
  }

  getContext(childAgentId: string): ForkContext | undefined {
    return this.forks.get(childAgentId)
  }

  getSharedState(childAgentId: string): Record<string, unknown> | undefined {
    return this.forks.get(childAgentId)?.sharedState
  }

  updateSharedState(childAgentId: string, key: string, value: unknown): void {
    const ctx = this.forks.get(childAgentId)
    if (!ctx) {
      throw new Error(`Fork context for ${childAgentId} not found`)
    }
    ctx.sharedState[key] = value
  }

  listForks(parentAgentId?: string): ForkContext[] {
    const all = Array.from(this.forks.values())
    if (parentAgentId) {
      return all.filter(f => f.parentAgentId === parentAgentId)
    }
    return all
  }

  removeFork(childAgentId: string): boolean {
    return this.forks.delete(childAgentId)
  }

  syncFromParent(childAgentId: string): Record<string, unknown> | undefined {
    const ctx = this.forks.get(childAgentId)
    if (!ctx) return undefined

    const parent = agentManager.get(ctx.parentAgentId)
    if (!parent) return undefined

    return { ...ctx.sharedState }
  }

  syncToParent(childAgentId: string, state: Record<string, unknown>): void {
    const ctx = this.forks.get(childAgentId)
    if (!ctx) {
      throw new Error(`Fork context for ${childAgentId} not found`)
    }
    ctx.sharedState = { ...ctx.sharedState, ...state }
  }
}

export const forkManager = new ForkManager()
