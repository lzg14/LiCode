import React, { useState, useEffect, useCallback } from 'react'
import { render, Box, Text } from 'ink'
import TextInput from 'ink-text-input'
import { bus, TUI_EVENTS } from './bus'
import { state, type Message } from './state'
import { themes } from './theme'
import { CoreLoop } from '../core/loop'
import { configLoader } from '../config/loader'
import { AnthropicProvider } from '../llm/anthropic'
import { OpenAIProvider } from '../llm/openai'
import { registerBuiltinTools } from '../tools/builtin'
import { globalToolRegistry } from '../tools/registry'
import type { LLMProvider } from '../llm/types'
import type { Phase } from '../core/types'

const PHASE_LABELS: Record<Phase, string> = {
  OBSERVE: '👀 观察',
  THINK: '🤔 思考',
  PLAN: '📋 规划',
  BUILD: '🔨 构建',
  EXECUTE: '⚡ 执行',
  VERIFY: '✅ 验证',
  LEARN: '📚 学习',
  DONE: '✓ 完成',
}

interface AppProps {
  config: any
  llm: LLMProvider
  loop: CoreLoop
}

function App({ config, llm, loop }: AppProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [phase, setPhase] = useState<Phase>('OBSERVE')
  const [streamingText, setStreamingText] = useState('')

  const addMessage = useCallback((msg: Omit<Message, 'id' | 'timestamp'>) => {
    setMessages(prev => [...prev, {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      ...msg,
    }])
  }, [])

  useEffect(() => {
    const unsubscribes = [
      bus.subscribe(TUI_EVENTS.PHASE_CHANGE, (newPhase: Phase) => {
        setPhase(newPhase)
      }),
      bus.subscribe(TUI_EVENTS.TOOL_CALL, (toolName: string) => {
        addMessage({ role: 'system', content: `🔧 调用工具: ${toolName}` })
      }),
      bus.subscribe(TUI_EVENTS.TOOL_RESULT, (result: any) => {
        addMessage({ role: 'system', content: `✓ 工具完成` })
      }),
    ]

    return () => unsubscribes.forEach(unsub => unsub())
  }, [addMessage])

  const handleSubmit = async (value: string) => {
    if (!value.trim() || isProcessing) return

    const userInput = value.trim()
    setInput('')
    addMessage({ role: 'user', content: userInput })
    setIsProcessing(true)
    setStreamingText('')

    try {
      const sessionId = crypto.randomUUID()

      // 创建流式上下文
      const ctx = {
        sessionId,
        userInput,
        effortLevel: 1,
        phase: 'OBSERVE' as Phase,
        cwd: process.cwd(),
        llm,
        onPhaseChange: (newPhase: Phase) => {
          setPhase(newPhase)
          bus.emit(TUI_EVENTS.PHASE_CHANGE, newPhase)
        },
        onStreamText: (text: string) => {
          setStreamingText(prev => prev + text)
        },
        onToolCall: (toolName: string) => {
          bus.emit(TUI_EVENTS.TOOL_CALL, toolName)
        },
        onToolResult: (result: any) => {
          bus.emit(TUI_EVENTS.TOOL_RESULT, result)
        },
      }

      const result = await loop.run(ctx)

      // 流式文本转为消息
      if (streamingText) {
        addMessage({ role: 'assistant', content: streamingText })
      } else {
        addMessage({ role: 'assistant', content: result })
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      addMessage({ role: 'system', content: `❌ 错误: ${error}` })
    } finally {
      setIsProcessing(false)
      setStreamingText('')
    }
  }

  return (
    <Box flexDirection="column" height="100%">
      {/* Header */}
      <Box flexDirection="column" marginBottom={1}>
        <Text color="cyan" bold>╔═══════════════════════════════════════╗</Text>
        <Text color="cyan" bold>║         licode - Personal AI          ║</Text>
        <Text color="cyan" bold>║     "宁可慢，不要白干"                 ║</Text>
        <Text color="cyan" bold>╚═══════════════════════════════════════╝</Text>
      </Box>

      {/* Messages */}
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {messages.map(msg => (
          <Box key={msg.id} marginBottom={1}>
            {msg.role === 'user' && (
              <Text color="cyan">[你] {msg.content}</Text>
            )}
            {msg.role === 'assistant' && (
              <Text color="green">[AI] {msg.content}</Text>
            )}
            {msg.role === 'system' && (
              <Text color="gray">{msg.content}</Text>
            )}
          </Box>
        ))}

        {/* Streaming text */}
        {streamingText && (
          <Box marginBottom={1}>
            <Text color="green">[AI] {streamingText}</Text>
          </Box>
        )}
      </Box>

      {/* Status bar */}
      <Box marginBottom={1}>
        <Text color="gray">
          Phase: {PHASE_LABELS[phase]} | Tools: {globalToolRegistry.list().length}
        </Text>
      </Box>

      {/* Input */}
      <Box>
        <Text color="cyan">❯ </Text>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          placeholder={isProcessing ? '处理中...' : '输入消息...'}
          showCursor={!isProcessing}
        />
      </Box>
    </Box>
  )
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
  // 注册工具
  registerBuiltinTools()

  // 加载配置
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

  // 创建 LLM
  const llm = await createLLMProvider(config)

  // 创建 Core Loop
  const loop = new CoreLoop(config, llm)

  // 检查是否支持 raw mode
  // 暂时强制使用简单模式，Ink TUI 需要在真实终端测试
  console.log('[DEBUG] useInk = false, using simple mode')
  await runReadlineTUI(config, llm, loop)
}

async function runReadlineTUI(config: any, llm: LLMProvider, loop: CoreLoop): Promise<void> {
  const readline = await import('readline')
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  console.log('\n[licode] 简单模式 (非交互式终端)\n')

  const ask = (): Promise<string> => {
    return new Promise((resolve) => {
      rl.question('> ', (answer) => {
        resolve(answer)
      })
    })
  }

  // 一次性读取所有输入
  const input = await ask()

  console.log('\n处理中...\n')

  try {
    const result = await loop.run({
      sessionId: crypto.randomUUID(),
      userInput: input,
      effortLevel: 1,
      phase: 'OBSERVE',
      cwd: process.cwd(),
      llm,
      onPhaseChange: (phase) => {
        console.log(`[Phase] ${phase}`)
      },
      onStreamText: (text) => {
        process.stdout.write(text)
      },
    })
    console.log('\n[完成]', result)
  } catch (e) {
    console.error('\n[错误]', e)
  }

  rl.close()
}
