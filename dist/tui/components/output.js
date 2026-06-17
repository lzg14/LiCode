import { bus, TUI_EVENTS } from '../bus';
import { state } from '../state';
export class Output {
    buffer = [];
    constructor() {
        bus.subscribe(TUI_EVENTS.USER_INPUT, (input) => {
            this.addMessage({ role: 'user', content: input });
        });
        bus.subscribe(TUI_EVENTS.TOOL_RESULT, (result) => {
            this.addMessage({ role: 'system', content: `Tool: ${JSON.stringify(result)}` });
        });
        bus.subscribe(TUI_EVENTS.ERROR, (error) => {
            this.addMessage({ role: 'system', content: `Error: ${error}` });
        });
    }
    addMessage(msg) {
        const message = {
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            ...msg,
        };
        state.messages.push(message);
        this.render();
    }
    render() {
        console.clear();
        const theme = state.theme;
        console.log(`\x1b[${theme.accent}m╔═══════════════════════════════════════╗\x1b[0m`);
        console.log(`\x1b[${theme.accent}m║         licode - Personal AI          ║\x1b[0m`);
        console.log(`\x1b[${theme.accent}m╚═══════════════════════════════════════╝\x1b[0m`);
        console.log();
        // 渲染消息
        for (const msg of state.messages.slice(-20)) {
            const color = msg.role === 'user' ? theme.accent : msg.role === 'assistant' ? theme.success : theme.dim;
            console.log(`\x1b[${color}m[${msg.role}]\x1b[0m ${msg.content}`);
        }
        // 状态栏
        console.log();
        console.log(`\x1b[${theme.dim}mPhase: ${state.phase} | ${state.isProcessing ? '⏳' : '✓'}\x1b[0m`);
        console.log();
    }
    clear() {
        this.buffer = [];
        state.messages = [];
        this.render();
    }
}
