export interface ContextState {
  baseline: string[]
  messages: Message[]
  snapshots: ContextSnapshot[]
  budget: number
}

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
}

export interface ContextSnapshot {
  id: string
  messages: Message[]
  timestamp: number
}

export class ContextManager {
  private state: ContextState = {
    baseline: [],
    messages: [],
    snapshots: [],
    budget: 100000,
  }

  addMessage(message: Omit<Message, 'id' | 'timestamp'>): Message {
    const msg: Message = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      ...message,
    }
    this.state.messages.push(msg)
    return msg
  }

  getMessages(): Message[] {
    return this.state.messages
  }

  getBudget(): number {
    return this.state.budget
  }

  compact(): void {
    // 上下文压缩逻辑
    const snapshot: ContextSnapshot = {
      id: crypto.randomUUID(),
      messages: [...this.state.messages],
      timestamp: Date.now(),
    }
    this.state.snapshots.push(snapshot)
  }
}
