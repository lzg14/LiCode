import { bus, TUI_EVENTS } from '../bus'
import { state, type Message } from '../state'
import { themes } from '../theme'

export class Output {
  private buffer: string[] = []

  constructor() {
    bus.subscribe(TUI_EVENTS.USER_INPUT, (input: string) => {
      this.addMessage({ role: 'user', content: input })
    })

    bus.subscribe(TUI_EVENTS.TOOL_RESULT, (result: any) => {
      this.addMessage({ role: 'system', content: `Tool: ${JSON.stringify(result)}` })
    })

    bus.subscribe(TUI_EVENTS.ERROR, (error: string) => {
      this.addMessage({ role: 'system', content: `Error: ${error}` })
    })
  }

  addMessage(msg: Omit<Message, 'id' | 'timestamp'>): void {
    const message: Message = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      ...msg,
    }
    state.messages.push(message)
    this.render()
  }

  render(): void {
    console.clear()
    const theme = state.theme

    console.log(`\x1b[${theme.accent}m╔═══════════════════════════════════════╗\x1b[0m`)
    console.log(`\x1b[${theme.accent}m║         licode - Personal AI          ║\x1b[0m`)
    console.log(`\x1b[${theme.accent}m╚═══════════════════════════════════════╝\x1b[0m`)
    console.log()

    // 渲染消息
    for (const msg of state.messages.slice(-20)) {
      const color = msg.role === 'user' ? theme.accent : msg.role === 'assistant' ? theme.success : theme.dim
      console.log(`\x1b[${color}m[${msg.role}]\x1b[0m ${msg.content}`)
    }

    // 状态栏
    console.log()
    console.log(`\x1b[${theme.dim}mPhase: ${state.phase} | ${state.isProcessing ? '⏳' : '✓'}\x1b[0m`)
    console.log()
  }

  clear(): void {
    this.buffer = []
    state.messages = []
    this.render()
  }
}
