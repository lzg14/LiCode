/**
 * Agent 事件系统
 * 
 * 参考 pi 的 packages/agent/src/types.ts 中的 AgentEvent
 * 定义判别联合事件类型，用于解耦循环与 UI/TUI
 */

/** 事件时间戳 */
export interface EventTimestamp {
  timestamp: number
}

// ============================================================
// Agent 级事件
// ============================================================

/** Agent 开始 */
export interface AgentStartEvent extends EventTimestamp {
  type: 'agent_start'
  sessionId: string
  userInput: string
  model: string
  provider: string
}

/** Agent 结束 */
export interface AgentEndEvent extends EventTimestamp {
  type: 'agent_end'
  sessionId: string
  totalIterations: number
  usage?: { input: number; output: number }
}

// ============================================================
// Turn 级事件
// ============================================================

/** Turn 开始（每轮 LLM 调用前） */
export interface TurnStartEvent extends EventTimestamp {
  type: 'turn_start'
  iteration: number
  messageCount: number
}

/** Turn 结束（每轮 LLM 调用后） */
export interface TurnEndEvent extends EventTimestamp {
  type: 'turn_end'
  iteration: number
  hasToolCalls: boolean
  finishReason: string
}

// ============================================================
// Message 级事件
// ============================================================

/** 消息开始（流式输出开始） */
export interface MessageStartEvent extends EventTimestamp {
  type: 'message_start'
  role: 'assistant'
}

/** 消息增量（流式输出 chunk） */
export interface MessageDeltaEvent extends EventTimestamp {
  type: 'message_delta'
  delta: string
  /** 是否为工具调用前的中间文本 */
  isIntermediate?: boolean
}

/** 消息结束 */
export interface MessageEndEvent extends EventTimestamp {
  type: 'message_end'
  role: 'assistant'
  text: string
  usage?: { input: number; output: number }
}

// ============================================================
// Tool 级事件
// ============================================================

/** 工具调用开始 */
export interface ToolStartEvent extends EventTimestamp {
  type: 'tool_start'
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
  batch: number
}

/** 工具结果 */
export interface ToolResultEvent extends EventTimestamp {
  type: 'tool_result'
  toolCallId: string
  toolName: string
  success: boolean
  output?: string
  error?: string
  durationMs: number
}

/** 工具更新（如进度） */
export interface ToolUpdateEvent extends EventTimestamp {
  type: 'tool_update'
  toolCallId: string
  toolName: string
  update: Record<string, unknown>
}

// ============================================================
// 错误事件
// ============================================================

/** 错误发生 */
export interface ErrorEvent extends EventTimestamp {
  type: 'error'
  error: Error | string
  context?: string
  iteration?: number
}

// ============================================================
// 状态变更事件
// ============================================================

/** 阶段变更 */
export interface PhaseChangeEvent extends EventTimestamp {
  type: 'phase_change'
  phase: string
}

/** 中间文本（用于 TUI 显示） */
export interface IntermediateTextEvent extends EventTimestamp {
  type: 'intermediate_text'
  text: string
}

// ============================================================
// AgentEvent 联合类型
// ============================================================

/**
 * Agent 事件判别联合
 * TUI/UI 通过 type 字段判断事件类型
 */
export type AgentEvent =
  | AgentStartEvent
  | AgentEndEvent
  | TurnStartEvent
  | TurnEndEvent
  | MessageStartEvent
  | MessageDeltaEvent
  | MessageEndEvent
  | ToolStartEvent
  | ToolResultEvent
  | ToolUpdateEvent
  | ErrorEvent
  | PhaseChangeEvent
  | IntermediateTextEvent

// ============================================================
// 事件处理接口
// ============================================================

/**
 * 事件处理器类型
 */
export type EventHandler = (event: AgentEvent) => void | Promise<void>

/**
 * 事件发射器接口
 */
export interface EventEmitter {
  emit(event: AgentEvent): void
  on(handler: EventHandler): () => void
  off(handler: EventHandler): void
}

/**
 * 创建事件发射器
 */
export function createEventEmitter(): EventEmitter {
  const handlers = new Set<EventHandler>()

  return {
    emit(event: AgentEvent) {
      for (const handler of handlers) {
        try {
          handler(event)
        } catch (e) {
          console.error('[EventEmitter] Handler error:', e)
        }
      }
    },
    on(handler: EventHandler) {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
    off(handler: EventHandler) {
      handlers.delete(handler)
    },
  }
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 创建带时间戳的事件
 */
export function createEvent<T extends Omit<AgentEvent, 'timestamp'>>(
  event: T,
): T & EventTimestamp {
  return { ...event, timestamp: Date.now() }
}

/**
 * 过滤事件类型
 */
export function filterEvents<T extends AgentEvent['type']>(
  events: AgentEvent[],
  type: T,
): Extract<AgentEvent, { type: T }>[] {
  return events.filter((e): e is Extract<AgentEvent, { type: T }> => e.type === type)
}
