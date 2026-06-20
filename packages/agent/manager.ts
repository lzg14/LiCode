import type { Agent, SpawnInput, AgentOutcome } from './types'
import { AGENT_TYPES, SUBAGENT_BLOCKED_TOOLS } from './types'
import { PermissionManager, PERMISSION_PRESETS, createPermissionManager } from '../security/permission'

/**
 * Agent 管理器 - 多 Agent 协调、并发控制、隔离策略
 */

export class AgentManager {
  private agents = new Map<string, Agent>()
  private runningCount = 0
  private permissions = new Map<string, PermissionManager>()

  constructor(
    private maxConcurrent = 3,
    private maxDepth = 1,
    private _timeoutMs = 900000
  ) {}

  /**
   * 派生子 Agent
   */
  async spawn(input: SpawnInput, parentId?: string): Promise<Agent | null> {
    // 检查并发限制
    if (this.runningCount >= this.maxConcurrent) {
      console.log(`[Agent] 达到并发限制 (${this.maxConcurrent})，等待中...`)
      return null
    }

    // 检查深度限制
    const parent = parentId ? this.agents.get(parentId) : null
    const depth = (parent?.depth ?? -1) + 1
    if (depth > this.maxDepth) {
      console.log(`[Agent] 达到深度限制 (${this.maxDepth})，无法派生`)
      return null
    }

    // 生成 Agent ID
    const agentId = `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    // 获取 Agent 类型配置
    const typeConfig = AGENT_TYPES[input.mode] || { type: input.mode, description: '' }

    // 确定工具列表
    let tools: string[]
    if (input.tools === 'inherit' && parent) {
      tools = parent.tools.filter((t: string) => !SUBAGENT_BLOCKED_TOOLS.includes(t))
    } else if (Array.isArray(input.tools)) {
      tools = input.tools
    } else {
      tools = typeConfig.tools ?? ['read', 'glob', 'grep', 'bash', 'write', 'edit']
    }

    // 子 Agent 阻止特定工具
    const blockedTools = input.mode === 'subagent' ? SUBAGENT_BLOCKED_TOOLS : []

    // 创建权限管理器
    const permissionPreset = input.mode === 'subagent' ? 'subagent' : 'primary'
    const permission = createPermissionManager(permissionPreset)

    const agent: Agent = {
      id: agentId,
      type: typeConfig.type,
      parentId: parentId,
      depth,
      sessionId: `session_${agentId}` as any,
      tools,
      blockedTools,
      status: 'idle',
      createdAt: Date.now(),
    }

    this.agents.set(agentId, agent)
    this.permissions.set(agentId, permission)
    this.runningCount++

    return agent
  }

  /**
   * 开始执行 Agent
   */
  start(agentId: string): boolean {
    const agent = this.agents.get(agentId)
    if (!agent) return false

    agent.status = 'running'
    return true
  }

  /**
   * 完成 Agent
   */
  complete(agentId: string, outcome: AgentOutcome): boolean {
    const agent = this.agents.get(agentId)
    if (!agent) return false

    agent.status = outcome.status === 'success' ? 'completed' : 'failed'
    agent.completedAt = Date.now()
    this.runningCount--

    return true
  }

  /**
   * 阻塞 Agent
   */
  block(agentId: string): boolean {
    const agent = this.agents.get(agentId)
    if (!agent) return false

    agent.status = 'blocked'
    return true
  }

  /**
   * 解除阻塞
   */
  unblock(agentId: string): boolean {
    const agent = this.agents.get(agentId)
    if (!agent) return false

    agent.status = 'running'
    return true
  }

  /**
   * 获取 Agent
   */
  get(agentId: string): Agent | undefined {
    return this.agents.get(agentId)
  }

  /**
   * 获取所有 Agent
   */
  list(): Agent[] {
    return Array.from(this.agents.values())
  }

  /**
   * 获取运行中的 Agent
   */
  getRunning(): Agent[] {
    return this.list().filter(a => a.status === 'running')
  }

  /**
   * 获取子 Agent
   */
  getChildren(parentId: string): Agent[] {
    return this.list().filter(a => a.parentId === parentId)
  }

  /**
   * 检查工具是否可用
   */
  canUseTool(agentId: string, toolName: string): boolean {
    const agent = this.agents.get(agentId)
    if (!agent) return false

    // 检查是否在阻止列表中
    if (agent.blockedTools.includes(toolName)) {
      return false
    }

    // 检查是否在允许列表中（空列表表示允许所有）
    if (agent.tools.length > 0 && !agent.tools.includes(toolName)) {
      return false
    }

    // 检查权限系统
    const permission = this.permissions.get(agentId)
    if (permission) {
      const result = permission.check({ tool: toolName })
      if (result.action === 'deny') {
        return false
      }
    }

    return true
  }

  /**
   * 获取 Agent 的权限管理器
   */
  getPermission(agentId: string): PermissionManager | undefined {
    return this.permissions.get(agentId)
  }

  /**
   * 清理已完成的 Agent
   */
  cleanup(maxAgeMs: number = 3600000): number {
    const now = Date.now()
    let count = 0

    for (const [id, agent] of this.agents.entries()) {
      if (
        (agent.status === 'completed' || agent.status === 'failed') &&
        agent.completedAt &&
        now - agent.completedAt > maxAgeMs
      ) {
        this.agents.delete(id)
        this.permissions.delete(id)
        count++
      } else if (
        agent.status === 'running' &&
        now - agent.createdAt > maxAgeMs
      ) {
        // 清理超时未完成的 running agent，防止 runningCount 泄漏
        agent.status = 'failed'
        agent.completedAt = now
        this.agents.delete(id)
        this.permissions.delete(id)
        this.runningCount--
        count++
      }
    }

    return count
  }
}

export const agentManager = new AgentManager()
