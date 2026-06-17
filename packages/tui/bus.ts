type EventHandler = (...args: any[]) => void

export class Bus {
  private handlers = new Map<string, Set<EventHandler>>()

  subscribe(event: string, handler: EventHandler): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set())
    }
    this.handlers.get(event)!.add(handler)
    return () => this.handlers.get(event)?.delete(handler)
  }

  emit(event: string, ...args: any[]): void {
    this.handlers.get(event)?.forEach(h => h(...args))
  }

  once(event: string, handler: EventHandler): () => void {
    const unsubscribe = this.subscribe(event, (...args) => {
      unsubscribe()
      handler(...args)
    })
    return unsubscribe
  }
}

export const bus = new Bus()

// 常用事件
export const TUI_EVENTS = {
  USER_INPUT: 'tui:user:input',
  PHASE_CHANGE: 'tui:phase:change',
  TOOL_CALL: 'tui:tool:call',
  TOOL_RESULT: 'tui:tool:result',
  ERROR: 'tui:error',
  RENDER: 'tui:render',
} as const
