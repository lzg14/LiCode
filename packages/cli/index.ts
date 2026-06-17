#!/usr/bin/env node
import { CoreLoop } from '../core/loop'
import { ConfigLoader } from '../config/loader'
import { configLoader } from '../config/loader'
import { registerBuiltinTools } from '../tools/builtin'
import { globalToolRegistry } from '../tools/registry'
import { AnthropicProvider } from '../llm/anthropic'
import { OpenAIProvider } from '../llm/openai'
import type { LLMProvider } from '../llm/types'
import * as readline from 'readline'

async function createLLMProvider(config: any): Promise<LLMProvider> {
  const apiKey = process.env[config.llm.apiKeyEnv] ?? ''

  switch (config.llm.provider) {
    case 'anthropic':
      return new AnthropicProvider(apiKey)
    case 'openai':
      return new OpenAIProvider(apiKey)
    default:
      throw new Error(`Unsupported LLM provider: ${config.llm.provider}`)
  }
}

async function main() {
  console.log('╔═══════════════════════════════════════╗')
  console.log('║         licode - Personal AI          ║')
  console.log('║     "宁可慢，不要白干"                 ║')
  console.log('╚═══════════════════════════════════════╝\n')

  // 注册内置工具
  registerBuiltinTools()
  console.log(`[✓] ${globalToolRegistry.list().length} tools loaded`)

  // 加载配置
  let config
  try {
    config = await configLoader.discoverAndLoad(process.env.HOME ?? process.env.USERPROFILE ?? '')
    console.log(`[✓] Config loaded`)
  } catch {
    console.log('[!] No config found, using defaults')
    config = {
      llm: { provider: 'anthropic', model: 'claude-sonnet-4-20250514', apiKeyEnv: 'ANTHROPIC_API_KEY' },
      security: { commandWhitelist: [], allowedPaths: [], deniedPaths: [] },
      memory: { path: './licode-memory.db', retentionDays: 30 },
      subagent: { maxConcurrent: 3, maxDepth: 1, timeoutMs: 900000, blockedTools: [] },
    }
  }

  // 创建 LLM Provider
  let llm: LLMProvider
  try {
    llm = await createLLMProvider(config)
    console.log(`[✓] LLM provider: ${config.llm.provider} / ${config.llm.model}`)
  } catch (e) {
    console.error('[✗] Failed to create LLM provider:', e)
    process.exit(1)
  }

  // 创建 Core Loop
  const loop = new CoreLoop(config, llm)

  // 交互式循环
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  const prompt = (question: string): Promise<string> =>
    new Promise(resolve => rl.question(question, resolve))

  console.log('\n[licode] 你好！有什么我可以帮你的？\n')

  while (true) {
    const input = await prompt('> ')
    if (!input.trim()) continue
    if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
      console.log('再见！')
      break
    }

    try {
      const ctx = await loop.run({
        sessionId: crypto.randomUUID(),
        userInput: input,
        effortLevel: 1,
        phase: 'OBSERVE',
        cwd: process.cwd(),
      })
      console.log('\n[✓] 完成\n')
    } catch (e) {
      console.error('[✗] Error:', e)
    }
  }

  rl.close()
}

main().catch(console.error)
