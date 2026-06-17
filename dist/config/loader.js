import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { ConfigSchema } from './schema';
import { importClaudeCodeConfig } from './external';
export class ConfigLoader {
    config = null;
    async load(path) {
        if (!existsSync(path)) {
            throw new Error(`Config file not found: ${path}`);
        }
        const file = readFileSync(path, 'utf-8');
        const data = JSON.parse(file);
        return ConfigSchema.parse(data);
    }
    async loadWithOverrides(basePath, overrides) {
        const base = await this.load(basePath);
        return { ...base, ...overrides };
    }
    async discoverAndLoad(home) {
        // 优先级:
        // 1. ~/.licode/config.json (显式配置)
        // 2. ./licode.config.json (本地配置)
        // 3. Claude Code 配置 (自动导入)
        const globalPath = join(home, '.licode', 'config.json');
        const localPath = join(process.cwd(), 'licode.config.json');
        if (existsSync(globalPath)) {
            return this.load(globalPath);
        }
        if (existsSync(localPath)) {
            return this.load(localPath);
        }
        // 尝试从 Claude Code 导入
        const claudeConfig = importClaudeCodeConfig();
        if (claudeConfig) {
            console.log('[✓] Imported LLM config from Claude Code');
            return {
                llm: {
                    provider: 'anthropic',
                    model: claudeConfig.model,
                    apiKeyEnv: 'ANTHROPIC_API_KEY',
                    apiKey: claudeConfig.apiKey,
                    baseUrl: claudeConfig.baseUrl,
                },
                security: { commandWhitelist: [], allowedPaths: [], deniedPaths: [] },
                memory: { path: './licode-memory.json', retentionDays: 30 },
                subagent: {
                    maxConcurrent: 3,
                    maxDepth: 1,
                    timeoutMs: 900000,
                    blockedTools: ['delegate_task', 'clarify', 'memory_write', 'send_message', 'execute_code'],
                },
            };
        }
        throw new Error('No config file found');
    }
}
export const configLoader = new ConfigLoader();
