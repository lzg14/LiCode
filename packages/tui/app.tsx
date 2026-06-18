import React, { useState, useEffect, useCallback, useRef } from 'react'
import { render, Box, Text, useInput, useApp } from 'ink'
import TextInput from 'ink-text-input'
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

const PHASE_COLORS: Record<Phase, string> = {
  OBSERVE: 'cyan',
  THINK: 'yellow',
  PLAN: 'blue',
  BUILD: 'magenta',
  EXECUTE: 'green',
  VERIFY: 'cyan',
  LEARN: 'white',
  DONE: 'green',
}

interface Message {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool' | 'phase'
  content: string
  timestamp: number
  phase?: Phase
  toolName?: string
  toolStatus?: 'pending' | 'running' | 'completed' | 'error'
}

interface AppProps {
  config: any
  llm: LLMProvider
  loop: CoreLoop
}

function Spinner({ color = 'cyan' }: { color?: string }) {
  const [frame, setFrame] = useState(0)
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame(f => (f + 1) % frames.length)
    }, 80)
    return () => clearInterval(timer)
  }, [])

  return <Text color={color}>{frames[frame]}</Text>
}

function App({ config, llm, loop }: AppProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [phase, setPhase] = useState<Phase>('OBSERVE')
  const [streamingText, setStreamingText] = useState('')
  const [toolCalls, setToolCalls] = useState<Map<string, string>>(new Map())
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [commandHistory, setCommandHistory] = useState<string[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const addMessage = useCallback((msg: Omit<Message, 'id' | 'timestamp'>) => {
    setMessages(prev => [...prev, {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      ...msg,
    }])
  }, [])

  const handleSubmit = async (value: string) => {
    if (!value.trim() || isProcessing) return

    const userInput = value.trim()
    setInput('')
    setCommandHistory(prev => [...prev, userInput])
    setHistoryIndex(-1)
    addMessage({ role: 'user', content: userInput })
    setIsProcessing(true)
    setStreamingText('')

    try {
      const sessionId = crypto.randomUUID()

      const ctx = {
        sessionId,
        userInput,
        effortLevel: 1,
        phase: 'OBSERVE' as Phase,
        cwd: process.cwd(),
        llm,
        onPhaseChange: (newPhase: Phase) => {
          setPhase(newPhase)
          addMessage({ role: 'phase', content: PHASE_LABELS[newPhase], phase: newPhase })
        },
        onStreamText: (text: string) => {
          setStreamingText(prev => prev + text)
        },
        onToolCall: (toolName: string) => {
          const callId = crypto.randomUUID()
          setToolCalls(prev => new Map(prev).set(callId, toolName))
          addMessage({ role: 'tool', content: toolName, toolName, toolStatus: 'running' })
        },
        onToolResult: (result: any) => {
          addMessage({ role: 'tool', content: '工具完成', toolStatus: 'completed' })
        },
      }

      const result = await loop.run(ctx)

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
      setToolCalls(new Map())
    }
  }

  useInput((input, key) => {
    if (key.upArrow) {
      if (historyIndex < commandHistory.length - 1) {
        const newIndex = historyIndex + 1
        setHistoryIndex(newIndex)
        setInput(commandHistory[commandHistory.length - 1 - newIndex])
      }
    }
    if (key.downArrow) {
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1
        setHistoryIndex(newIndex)
        setInput(commandHistory[commandHistory.length - 1 - newIndex])
      } else if (historyIndex === 0) {
        setHistoryIndex(-1)
        setInput('')
      }
    }
  })

  return (
    <Box flexDirection="column" height="100%">
      {/* Header */}
      <Box flexDirection="column" marginBottom={1} borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text bold color="cyan">
          {' '}licode <Text color="gray">v0.1.0</Text>
        </Text>
        <Text color="gray">{' '}宁可慢，不要白干</Text>
      </Box>

      {/* Messages */}
      <Box flexDirection="column" flexGrow={1} overflow="hidden" paddingX={1}>
        {messages.length === 0 && (
          <Text color="gray">输入消息开始对话... (↑↓ 浏览历史)</Text>
        )}

        {messages.map(msg => (
          <Box key={msg.id} marginBottom={1} flexDirection="column">
            {msg.role === 'user' && (
              <Text>
                <Text color="cyan" bold>❯ </Text>
                <Text color="white">{msg.content}</Text>
              </Text>
            )}

            {msg.role === 'assistant' && (
              <Text>
                <Text color="green" bold>AI </Text>
                <Text color="white">{msg.content}</Text>
              </Text>
            )}

            {msg.role === 'phase' && (
              <Text color={PHASE_COLORS[msg.phase || 'OBSERVE']}>
                {'  '}{msg.content}
              </Text>
            )}

            {msg.role === 'tool' && (
              <Text>
                <Text color="yellow">{'  '}</Text>
                {msg.toolStatus === 'running' && <Spinner color="yellow" />}
                {msg.toolStatus === 'completed' && <Text color="green">✓</Text>}
                {msg.toolStatus === 'error' && <Text color="red">✗</Text>}
                <Text color="gray"> {msg.toolName}</Text>
              </Text>
            )}

            {msg.role === 'system' && (
              <Text color="gray">{msg.content}</Text>
            )}
          </Box>
        ))}

        {/* Streaming text */}
        {streamingText && (
          <Box marginBottom={1}>
            <Text>
              <Text color="green" bold>AI </Text>
              <Text color="white">{streamingText}</Text>
            </Text>
          </Box>
        )}

        {/* Processing indicator */}
        {isProcessing && !streamingText && (
          <Box>
            <Spinner color="cyan" />
            <Text color="gray"> {' '}处理中...</Text>
          </Box>
        )}
      </Box>

      {/* Status bar */}
      <Box paddingX={1} marginBottom={1}>
        <Text color="gray">
          Phase: <Text color={PHASE_COLORS[phase]}>{PHASE_LABELS[phase]}</Text>
          {' | '}
          Tools: <Text color="yellow">{globalToolRegistry.list().length}</Text>
          {isProcessing && <Text color="yellow"> | ⏳</Text>}
        </Text>
      </Box>

      {/* Input */}
      <Box paddingX={1} borderStyle="round" borderColor={isProcessing ? 'gray' : 'cyan'}>
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

  // 强制使用简单模式（Ink TUI 需要在真实终端测试）
  console.log('[licode] 简单模式')
  await runReadlineTUI(config, llm, loop)
}

async function runReadlineTUI(config: any, llm: LLMProvider, loop: CoreLoop): Promise<void> {
  const readline = await import('readline')
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  // 彩色输出辅助
  const c = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    gray: '\x1b[90m',
  }

  const phaseColors: Record<string, string> = {
    OBSERVE: c.cyan,
    THINK: c.yellow,
    PLAN: c.blue,
    BUILD: c.magenta,
    EXECUTE: c.green,
    VERIFY: c.cyan,
    LEARN: c.white,
  }

  const phaseLabels: Record<string, string> = {
    OBSERVE: '👀 观察',
    THINK: '🤔 思考',
    PLAN: '📋 规划',
    BUILD: '🔨 构建',
    EXECUTE: '⚡ 执行',
    VERIFY: '✅ 验证',
    LEARN: '📚 学习',
  }

  console.log()
  console.log(`${c.cyan}${c.bold}╔═══════════════════════════════════════╗${c.reset}`)
  console.log(`${c.cyan}${c.bold}║         licode - Personal AI          ║${c.reset}`)
  console.log(`${c.cyan}${c.bold}║     "宁可慢，不要白干"                 ║${c.reset}`)
  console.log(`${c.cyan}${c.bold}╚═══════════════════════════════════════╝${c.reset}`)
  console.log(`${c.gray}  Tools: ${globalToolRegistry.list().length} | ↑↓ 浏览历史 | exit 退出${c.reset}`)
  console.log()

  const commandHistory: string[] = []

  const ask = (): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(`${c.cyan}${c.bold}❯ ${c.reset}`, (answer) => {
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
        console.log(`${c.gray}没有输入${c.reset}`)
        return
      }

      console.log(`\n${c.gray}处理中...${c.reset}\n`)

      try {
        const result = await loop.run({
          sessionId: crypto.randomUUID(),
          userInput: input,
          effortLevel: 1,
          phase: 'OBSERVE',
          cwd: process.cwd(),
          llm,
          onPhaseChange: (phase) => {
            const color = phaseColors[phase] || c.reset
            const label = phaseLabels[phase] || phase
            console.log(`  ${color}${label}${c.reset}`)
          },
          onStreamText: (text) => {
            process.stdout.write(`${c.green}${text}${c.reset}`)
          },
          onToolCall: (toolName) => {
            console.log(`  ${c.yellow}🔧 ${toolName}${c.reset}`)
          },
        })

        console.log(`\n${c.gray}${'─'.repeat(40)}${c.reset}\n`)
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e)
        console.error(`\n${c.red}❌ 错误: ${error}${c.reset}\n`)
      }
    })
    return
  }

  // 交互模式
  while (true) {
    const input = await ask()

    if (input.toLowerCase() === 'exit') {
      console.log(`\n${c.gray}再见！${c.reset}`)
      break
    }

    if (!input.trim()) continue

    commandHistory.push(input)

    console.log(`\n${c.gray}处理中...${c.reset}\n`)

    try {
      const result = await loop.run({
        sessionId: crypto.randomUUID(),
        userInput: input,
        effortLevel: 1,
        phase: 'OBSERVE',
        cwd: process.cwd(),
        llm,
        onPhaseChange: (phase) => {
          const color = phaseColors[phase] || c.reset
          const label = phaseLabels[phase] || phase
          console.log(`  ${color}${label}${c.reset}`)
        },
        onStreamText: (text) => {
          process.stdout.write(`${c.green}${text}${c.reset}`)
        },
        onToolCall: (toolName) => {
          console.log(`  ${c.yellow}🔧 ${toolName}${c.reset}`)
        },
      })

      console.log(`\n${c.gray}${'─'.repeat(40)}${c.reset}\n`)
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      console.error(`\n${c.red}❌ 错误: ${error}${c.reset}\n`)
    }
  }

  rl.close()
}
