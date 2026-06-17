import type { Agent, SpawnInput } from './types'
import { isBlockedTool } from './blocked-tools'
import { limitManager, DEFAULT_LIMITS } from './limits'

export class AgentManager {
  private agents = new Map<string, Agent>()

  spawn(input: SpawnInput, parentDepth = 0): Agent {
    if (!limitManager.canSpawn(parentDepth)) {
      throw new Error('Max concurrent agents or depth reached')
    }

    limitManager.spawn()

    const tools = input.tools === 'inherit'
      ? this.getInheritedTools()
      : input.tools.filter(t => !isBlockedTool(t))

    const agent: Agent = {
      id: crypto.randomUUID(),
      type: input.mode,
      parentId: input.parentId,
      depth: parentDepth + 1,
      sessionId: '' as any,
      tools,
      blockedTools: [...SUBAGENT_BLOCKED_TOOLS],
      createdAt: Date.now(),
    }

    this.agents.set(agent.id, agent)
    return agent
  }

  private getInheritedTools(): string[] {
    return []
  }

  get(id: string): Agent | undefined {
    return this.agents.get(id)
  }

  terminate(agentId: string): void {
    this.agents.delete(agentId)
    limitManager.terminate()
  }

  list(): Agent[] {
    return Array.from(this.agents.values())
  }
}

export const agentManager = new AgentManager()
