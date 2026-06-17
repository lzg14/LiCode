import { bus, TUI_EVENTS } from './bus';
import { state } from './state';
import { Prompt } from './components/prompt';
import { Output } from './components/output';
import { CoreLoop } from '../core/loop';
import { configLoader } from '../config/loader';
import { AnthropicProvider } from '../llm/anthropic';
import { OpenAIProvider } from '../llm/openai';
import { registerBuiltinTools } from '../tools/builtin';
import { globalToolRegistry } from '../tools/registry';
async function createLLMProvider(config) {
    let apiKey = '';
    let baseUrl = 'https://api.anthropic.com/v1';
    // 优先使用直接传入的 apiKey
    if (config.llm.apiKey) {
        apiKey = config.llm.apiKey;
    }
    else if (config.llm.apiKeyEnv) {
        apiKey = process.env[config.llm.apiKeyEnv] ?? '';
    }
    if (config.llm.baseUrl) {
        baseUrl = config.llm.baseUrl;
    }
    if (!apiKey) {
        throw new Error('No API key available');
    }
    if (config.llm.provider === 'anthropic') {
        return new AnthropicProvider(apiKey, baseUrl);
    }
    return new OpenAIProvider(apiKey);
}
export async function runTUI() {
    console.log('\x1b[36m╔═══════════════════════════════════════╗\x1b[0m');
    console.log('\x1b[36m║         licode - Personal AI          ║\x1b[0m');
    console.log('\x1b[36m║     "宁可慢，不要白干"                 ║\x1b[0m');
    console.log('\x1b[36m╚═══════════════════════════════════════╝\x1b[0m\n');
    // 注册工具
    registerBuiltinTools();
    console.log(`\x1b[32m[✓]\x1b[0m ${globalToolRegistry.list().length} tools loaded`);
    // 加载配置
    let config;
    try {
        config = await configLoader.discoverAndLoad(process.env.HOME ?? '');
        console.log('\x1b[32m[✓]\x1b[0m Config loaded');
    }
    catch {
        config = {
            llm: { provider: 'anthropic', model: 'claude-sonnet-4-20250514', apiKeyEnv: 'ANTHROPIC_API_KEY' },
            security: { commandWhitelist: [], allowedPaths: [], deniedPaths: [] },
            memory: { path: './licode-memory.db', retentionDays: 30 },
            subagent: { maxConcurrent: 3, maxDepth: 1, timeoutMs: 900000, blockedTools: [] },
        };
        console.log('\x1b[33m[!]\x1b[0m Using default config');
    }
    // 创建 LLM
    const llm = await createLLMProvider(config);
    console.log(`\x1b[32m[✓]\x1b[0m LLM: ${config.llm.provider} / ${config.llm.model}\n`);
    // 创建 Core Loop
    const loop = new CoreLoop(config);
    // 创建 TUI 组件
    const output = new Output();
    const prompt = new Prompt();
    // 处理用户输入
    bus.subscribe(TUI_EVENTS.USER_INPUT, async (input) => {
        state.isProcessing = true;
        output.render();
        try {
            await loop.run({
                sessionId: crypto.randomUUID(),
                userInput: input,
                effortLevel: 1,
                phase: 'OBSERVE',
                cwd: process.cwd(),
                llm,
            });
            output.addMessage({ role: 'assistant', content: '完成' });
        }
        catch (e) {
            const error = e instanceof Error ? e.message : String(e);
            bus.emit(TUI_EVENTS.ERROR, error);
        }
        finally {
            state.isProcessing = false;
            output.render();
        }
    });
    // 运行
    console.log('\x1b[36m[licode] 你好！有什么我可以帮你的？\x1b[0m\n');
    await prompt.run();
    prompt.close();
}
