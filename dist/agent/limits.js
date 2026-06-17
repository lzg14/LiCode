export const DEFAULT_LIMITS = {
    maxConcurrent: 3,
    maxDepth: 1,
    timeoutMs: 900000,
};
class AgentLimitManager {
    current = 0;
    canSpawn(parentDepth) {
        if (this.current >= DEFAULT_LIMITS.maxConcurrent)
            return false;
        if (parentDepth >= DEFAULT_LIMITS.maxDepth)
            return false;
        return true;
    }
    spawn() {
        this.current++;
    }
    terminate() {
        this.current = Math.max(0, this.current - 1);
    }
    getCurrent() {
        return this.current;
    }
}
export const limitManager = new AgentLimitManager();
