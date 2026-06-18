import { CoreLoop } from '../core/loop'
import { configLoader } from '../config/loader'
import { AnthropicProvider } from '../llm/anthropic'
import { OpenAIProvider } from '../llm/openai'
import { registerBuiltinTools } from '../tools/builtin'
import { globalToolRegistry } from '../tools/registry'
import { renderMarkdown, c } from './markdown'
import type { LLMProvider } from '../llm/types'
import type { Phase } from '../core/types'

const PHASE_LABELS: Record<Phase, string> = {
  OBSERVE: '观察',
  THINK: '思考',
  PLAN: '规划',
  BUILD: '构建',
  EXECUTE: '执行',
  VERIFY: '验证',
  LEARN: '学习',
  DONE: '完成',
}

async function createLLMProvider(config: any): Promise<LLMProvider> {
  let apiKey = ''
  let baseUrl = 'https://api.anthropic.com/v1'

  if (config.llm.apiKey) {
    apiKey = config.llm.apiKey
  } else if (config.llm.apiKeyEnv) {
    apiKey = process.env[config.llm.apiKeyEnv] ?? ''
  }

  if (config.llm.baseUrl) {
    baseUrl = config.llm.baseUrl
  }

  if (!apiKey) {
    throw new Error('No API key available')
  }

  if (config.llm.provider === 'anthropic') {
    return new AnthropicProvider(apiKey, baseUrl)
  }
  return new OpenAIProvider(apiKey)
}

export async function runTUI(): Promise<void> {
  registerBuiltinTools()

  let config
  try {
    config = await configLoader.discoverAndLoad(process.env.HOME ?? '')
  } catch {
    config = {
      llm: { provider: 'anthropic' as const, model: 'claude-sonnet-4-20250514', apiKeyEnv: 'ANTHROPIC_API_KEY' },
      security: { commandWhitelist: [], allowedPaths: [], deniedPaths: [] },
      memory: { path: './licode-memory.db', retentionDays: 30 },
      subagent: { maxConcurrent: 3, maxDepth: 1, timeoutMs: 900000, blockedTools: [] },
    }
  }

  const llm = await createLLMProvider(config)
  const loop = new CoreLoop(config, llm)

  await runReadlineTUI(config, llm, loop)
}

function renderLogo(): string {
  return `${c.cyan}${c.bold}
    _      _     ___  ___  ____
   | |    | |   / _ \\/ _ \\|  _ \\
   | |    | |  | |_| | |_| | | | |
   | |___ | |__|  __/|  __/| |_| |
   |_____|_____|_|   |_|   |____/${c.reset}
${c.gray}           谋定而后动${c.reset}`
}

function renderStatusBar(toolCount: number, model: string): string {
  return `${c.gray}────────────────────────────────────────${c.reset}
${c.gray} ${toolCount} tools · ${model} · ↑↓ history${c.reset}`
}

async function runReadlineTUI(config: any, llm: LLMProvider, loop: CoreLoop): Promise<void> {
  const readline = await import('readline')
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  // 显示 Logo
  console.log(renderLogo())
  console.log(renderStatusBar(globalToolRegistry.list().length, config.llm.model))
  console.log()

  const commandHistory: string[] = []

  const ask = (): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(`${c.cyan}❯ ${c.reset}`, (answer) => {
        resolve(answer)
      })
    })
  }

  // 一次性读取所有输入（管道模式）
  if (!process.stdin.isTTY) {
    const lines: string[] = []
    rl.on('line', (line) => lines.push(line))
    rl.on('close', async () => {
      const input = lines[0] || ''
      if (!input.trim()) {
        return
      }

      console.log()

      try {
        let streamedText = ''
        const result = await loop.run({
          sessionId: crypto.randomUUID(),
          userInput: input,
          effortLevel: 1,
          phase: 'OBSERVE',
          cwd: process.cwd(),
          llm,
          onPhaseChange: () => {},
          onStreamText: (text) => {
            streamedText += text
          },
          onToolCall: (toolName) => {
            console.log(`  ${c.yellow}⚙ ${toolName}${c.reset}`)
          },
        })

        // 显示最终回复
        const response = streamedText || result
        if (response) {
          console.log(renderMarkdown(response))
        }

        console.log()
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e)
        console.error(`\n${c.red}✗ ${error}${c.reset}\n`)
      }
    })
    return
  }

  // 交互模式
  while (true) {
    const input = await ask()

    if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
      console.log(`\n${c.gray}再见！${c.reset}\n`)
      break
    }

    if (!input.trim()) continue

    commandHistory.push(input)
    console.log()

    try {
      let streamedText = ''
      const result = await loop.run({
        sessionId: crypto.randomUUID(),
        userInput: input,
        effortLevel: 1,
        phase: 'OBSERVE',
        cwd: process.cwd(),
        llm,
        onPhaseChange: () => {},
        onStreamText: (text) => {
          streamedText += text
          process.stdout.write(renderMarkdown(text))
        },
        onToolCall: (toolName) => {
          console.log(`\n  ${c.yellow}⚙ ${toolName}${c.reset}`)
        },
      })

      // 如果没有流式输出，显示最终结果
      if (!streamedText && result) {
        console.log(renderMarkdown(result))
      }

      console.log(`\n${c.gray}────────────────────────────────────────${c.reset}\n`)
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      console.error(`\n${c.red}✗ ${error}${c.reset}\n`)
    }
  }

  rl.close()
}
