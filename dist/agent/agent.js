import { isBlockedTool, SUBAGENT_BLOCKED_TOOLS } from './blocked-tools';
import { limitManager } from './limits';
export class AgentManager {
    agents = new Map();
    spawn(input, parentDepth = 0) {
        if (!limitManager.canSpawn(parentDepth)) {
            throw new Error('Max concurrent agents or depth reached');
        }
        limitManager.spawn();
        const tools = input.tools === 'inherit'
            ? this.getInheritedTools()
            : input.tools.filter(t => !isBlockedTool(t));
        const agent = {
            id: crypto.randomUUID(),
            type: input.mode,
            parentId: input.parentId,
            depth: parentDepth + 1,
            sessionId: '',
            tools,
            blockedTools: [...SUBAGENT_BLOCKED_TOOLS],
            createdAt: Date.now(),
        };
        this.agents.set(agent.id, agent);
        return agent;
    }
    getInheritedTools() {
        return [];
    }
    get(id) {
        return this.agents.get(id);
    }
    terminate(agentId) {
        this.agents.delete(agentId);
        limitManager.terminate();
    }
    list() {
        return Array.from(this.agents.values());
    }
}
export const agentManager = new AgentManager();
