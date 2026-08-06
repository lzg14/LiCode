/**
 * Agent 状态管理器
 * 
 * 参考 pi 的 Agent 类
 * 有状态外壳：持 transcript/状态集，processEvents 广播 + subscribe()
 */

import type { AgentEvent, EventHandler, EventEmitter } from './events'
import { createEventEmitter } from './events'

/** Agent 状态 */
export interface AgentStateData {
  /** 会话 ID */
  sessionId: string
  /** 当前阶段 */
  phase: 'idle' | 'running' | 'blocked' | 'completed' | 'failed'
  /** 当前迭代次数 */
  iteration: number
  /** 总迭代次数 */
  totalIterations: number
  /** 用户输入 */
  userInput: string
  /** 当前模型 */
  model: string
  /** 当前 provider */
  provider: string
  /** 累计 token 使用量 */
  usage: { input: number; output: number }
  /** 完整的事件历史 */
  events: AgentEvent[]
  /** 是否有工具调用 */
  hasToolCalls: boolean
  /** 最后的错误 */
  lastError?: Error | string
}

/** 状态变更回调 */
export type StateChangeHandler = (state: AgentStateData) => void

/**
 * Agent 状态管理器
 * 
 * 职责：
 * 1. 持有 agent 状态
 * 2. 接收事件并更新状态
 * 3. 广播事件给订阅者
 * 4. 广播状态变更给订阅者
 */
export class AgentState {
  private emitter: EventEmitter
  private stateChangeHandlers: Set<StateChangeHandler> = new Set()
  private state: AgentStateData

  constructor(initialState: Partial<AgentStateData> = {}) {
    this.emitter = createEventEmitter()
    this.state = {
      sessionId: initialState.sessionId ?? '',
      phase: initialState.phase ?? 'idle',
      iteration: initialState.iteration ?? 0,
      totalIterations: initialState.totalIterations ?? 0,
      userInput: initialState.userInput ?? '',
      model: initialState.model ?? '',
      provider: initialState.provider ?? '',
      usage: initialState.usage ?? { input: 0, output: 0 },
      events: initialState.events ?? [],
      hasToolCalls: initialState.hasToolCalls ?? false,
      lastError: initialState.lastError,
    }
  }

  /**
   * 获取当前状态（只读副本）
   */
  getState(): Readonly<AgentStateData> {
    return { ...this.state }
  }

  /**
   * 更新状态
   */
  private updateState(partial: Partial<AgentStateData>): void {
    this.state = { ...this.state, ...partial }
    this.notifyStateChange()
  }

  /**
   * 处理事件（核心方法）
   * 
   * 接收事件 → 更新状态 → 广播事件
   */
  processEvent(event: AgentEvent): void {
    // 1. 记录事件到历史
    this.state.events.push(event)

    // 2. 根据事件类型更新状态
    switch (event.type) {
      case 'agent_start':
        this.updateState({
          phase: 'running',
          sessionId: event.sessionId,
          userInput: event.userInput,
          model: event.model,
          provider: event.provider,
          iteration: 0,
          totalIterations: 0,
          usage: { input: 0, output: 0 },
          events: [],
          hasToolCalls: false,
          lastError: undefined,
        })
        break

      case 'agent_end':
        this.updateState({
          phase: 'completed',
          totalIterations: event.totalIterations,
          usage: event.usage ?? this.state.usage,
        })
        break

      case 'turn_start':
        this.updateState({
          iteration: event.iteration,
          hasToolCalls: false,
        })
        break

      case 'turn_end':
        this.updateState({
          hasToolCalls: event.hasToolCalls,
        })
        break

      case 'message_delta':
        // 流式更新，不触发状态变更通知
        break

      case 'message_end':
        if (event.usage) {
          this.updateState({
            usage: {
              input: this.state.usage.input + event.usage.input,
              output: this.state.usage.output + event.usage.output,
            },
          })
        }
        break

      case 'tool_start':
        this.updateState({ hasToolCalls: true })
        break

      case 'tool_result':
        // 工具完成，不触发状态变更
        break

      case 'error':
        this.updateState({
          phase: 'failed',
          lastError: event.error,
        })
        break

      case 'phase_change':
        this.updateState({ phase: event.phase as AgentStateData['phase'] })
        break
    }

    // 3. 广播事件给订阅者
    this.emitter.emit(event)
  }

  /**
   * 批量处理事件
   */
  processEvents(events: AgentEvent[]): void {
    for (const event of events) {
      this.processEvent(event)
    }
  }

  /**
   * 订阅事件
   */
  subscribe(handler: EventHandler): () => void {
    return this.emitter.on(handler)
  }

  /**
   * 取消订阅
   */
  unsubscribe(handler: EventHandler): void {
    this.emitter.off(handler)
  }

  /**
   * 订阅状态变更
   */
  onStateChange(handler: StateChangeHandler): () => void {
    this.stateChangeHandlers.add(handler)
    return () => {
      this.stateChangeHandlers.delete(handler)
    }
  }

  /**
   * 通知状态变更
   */
  private notifyStateChange(): void {
    const state = this.getState()
    for (const handler of this.stateChangeHandlers) {
      try {
        handler(state)
      } catch (e) {
        console.error('[AgentState] State change handler error:', e)
      }
    }
  }

  /**
   * 重置状态
   */
  reset(): void {
    this.state = {
      sessionId: '',
      phase: 'idle',
      iteration: 0,
      totalIterations: 0,
      userInput: '',
      model: '',
      provider: '',
      usage: { input: 0, output: 0 },
      events: [],
      hasToolCalls: false,
    }
    this.notifyStateChange()
  }

  /**
   * 获取事件历史
   */
  getEvents(): ReadonlyArray<AgentEvent> {
    return this.state.events
  }

  /**
   * 获取指定类型的事件
   */
  getEventsByType<T extends AgentEvent['type']>(
    type: T,
  ): Extract<AgentEvent, { type: T }>[] {
    return this.state.events.filter(
      (e): e is Extract<AgentEvent, { type: T }> => e.type === type
    )
  }

  /**
   * 获取累计使用量
   */
  getUsage(): Readonly<{ input: number; output: number }> {
    return this.state.usage
  }
}

/**
 * 创建 AgentState 单例（用于全局共享）
 */
let globalState: AgentState | null = null

export function getAgentState(): AgentState {
  if (!globalState) {
    globalState = new AgentState()
  }
  return globalState
}

export function resetAgentState(): void {
  globalState = null
}
