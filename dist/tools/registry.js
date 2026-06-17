export class ToolRegistry {
    tools = new Map();
    register(tool) {
        this.tools.set(tool.name, tool);
    }
    get(name) {
        return this.tools.get(name);
    }
    list() {
        return Array.from(this.tools.values());
    }
    async execute(name, input) {
        const tool = this.tools.get(name);
        if (!tool) {
            return { success: false, error: `Tool not found: ${name}` };
        }
        try {
            const result = await tool.handler(input);
            return result;
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }
}
export const globalToolRegistry = new ToolRegistry();
