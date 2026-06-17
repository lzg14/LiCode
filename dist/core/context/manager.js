export class ContextManager {
    state = {
        baseline: [],
        messages: [],
        snapshots: [],
        budget: 100000,
    };
    addMessage(message) {
        const msg = {
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            ...message,
        };
        this.state.messages.push(msg);
        return msg;
    }
    getMessages() {
        return this.state.messages;
    }
    getBudget() {
        return this.state.budget;
    }
    compact() {
        // 上下文压缩逻辑
        const snapshot = {
            id: crypto.randomUUID(),
            messages: [...this.state.messages],
            timestamp: Date.now(),
        };
        this.state.snapshots.push(snapshot);
    }
}
