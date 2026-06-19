import React, { useState, useEffect, useCallback, useRef } from 'react'
import { render, Box, Text, useInput, useApp, Static } from 'ink'
import TextInput from 'ink-text-input'
import Spinner from 'ink-spinner'
import { CoreLoop } from '../core/loop'
import { configLoader } from '../config/loader'
import { AnthropicProvider } from '../llm/anthropic'
import { OpenAIProvider } from '../llm/openai'
import { registerBuiltinTools } from '../tools/builtin'
import { globalToolRegistry } from '../tools/registry'
import { renderMarkdown, c } from './markdown'
import type { LLMProvider } from '../llm/types'
import type { Phase } from '../core/types'
import { homedir } from 'os'
import { join } from 'path'

interface Message {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  timestamp: number
  toolName?: string
  toolStatus?: 'pending' | 'running' | 'completed' | 'error'
  duration?: number
}

interface AppProps {
  config: any
  llm: LLMProvider
  loop: CoreLoop
}

// Agent 颜色
const AGENT_COLORS = {
  build: '#fb8147',
  plan: '#c7e2a8',
  explore: '#f5c9b0',
  default: '#aac4e1',
}

function App({ config, llm, loop }: AppProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const streamingTextRef = useRef('')
  const [agent] = useState('build')
  const [model] = useState(config.llm.model)
  const [elapsed, setElapsed] = useState(0)
  const startTimeRef = useRef<number>(0)

  const addMessage = useCallback((msg: Omit<Message, 'id' | 'timestamp'>) => {
    setMessages(prev => [...prev, {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      ...msg,
    }])
  }, [])

  useEffect(() => {
    let timer: NodeJS.Timeout
    if (isProcessing && startTimeRef.current) {
      timer = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000))
      }, 1000)
    }
    return () => clearInterval(timer)
  }, [isProcessing])

  const handleSubmit = async (value: string) => {
    if (!value.trim() || isProcessing) return

    const userInput = value.trim()
    setInput('')
    addMessage({ role: 'user', content: userInput })
    setIsProcessing(true)
    setStreamingText('')
    startTimeRef.current = Date.now()

    try {
      const sessionId = crypto.randomUUID()

      const ctx = {
        sessionId,
        userInput,
        effortLevel: 1,
        phase: 'OBSERVE' as Phase,
        cwd: process.cwd(),
        llm,
        onPhaseChange: () => {},
        onStreamText: (text: string) => {
          streamingTextRef.current += text
          setStreamingText(prev => prev + text)
        },
        onToolCall: (toolName: string) => {
          addMessage({ role: 'tool', content: toolName, toolName, toolStatus: 'running' })
        },
        onToolResult: () => {
          setMessages(prev => {
            const last = prev[prev.length - 1]
            if (last?.role === 'tool') {
              return [...prev.slice(0, -1), { ...last, toolStatus: 'completed' }]
            }
            return prev
          })
        },
      }

      const result = await loop.run(ctx)

      if (streamingTextRef.current) {
        addMessage({ role: 'assistant', content: streamingTextRef.current, duration: elapsed })
      } else {
        addMessage({ role: 'assistant', content: result, duration: elapsed })
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      addMessage({ role: 'system', content: `Error: ${error}` })
    } finally {
      setIsProcessing(false)
      setStreamingText('')
      streamingTextRef.current = ''
      startTimeRef.current = 0
      setElapsed(0)
    }
  }

  return (
    <Box flexDirection="column" height="100%">
      {/* 消息列表 */}
      <Box flexDirection="column" flexGrow={1} overflow="hidden" paddingX={1}>
        {messages.length === 0 && (
          <Box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
            <Text color="cyan" bold>
              {'  _      _     ___  ___  ____'}
            </Text>
            <Text color="cyan" bold>
              {' | |    | |   / _ \\/ _ \\|  _ \\'}
            </Text>
            <Text color="cyan" bold>
              {' | |    | |  | |_| | |_| | | | |'}
            </Text>
            <Text color="cyan" bold>
              {' | |___ | |__|  __/|  __/| |_| |'}
            </Text>
            <Text color="cyan" bold>
              {' |_____|_____|\\___/|____/|____/'}
            </Text>
            <Text color="gray">{'           谋定而后动'}</Text>
            <Text color="gray">{' '}</Text>
            <Text color="gray">{`  ${globalToolRegistry.list().length} tools · ${model}`}</Text>
          </Box>
        )}

        {messages.map((msg, i) => (
          <Box key={msg.id} marginBottom={1} flexDirection="column">
            {msg.role === 'user' && (
              <Box borderStyle="single" borderLeft={true} borderColor={AGENT_COLORS[agent as keyof typeof AGENT_COLORS] || AGENT_COLORS.default} paddingLeft={1}>
                <Text>{msg.content}</Text>
              </Box>
            )}

            {msg.role === 'assistant' && (
              <Box flexDirection="column">
                <Text>{renderMarkdown(msg.content)}</Text>
                {msg.duration !== undefined && i === messages.length - 1 && (
                  <Text color="gray" dimColor>{`▣ ${agent} · ${model} · ${msg.duration}s`}</Text>
                )}
              </Box>
            )}

            {msg.role === 'tool' && (
              <Box>
                {msg.toolStatus === 'running' && <Spinner type="dots" />}
                {msg.toolStatus === 'completed' && <Text color="green">✓</Text>}
                {msg.toolStatus === 'error' && <Text color="red">✗</Text>}
                <Text color="gray">{` ${msg.toolName}`}</Text>
              </Box>
            )}

            {msg.role === 'system' && (
              <Text color="red">{msg.content}</Text>
            )}
          </Box>
        ))}

        {/* 流式文本 */}
        {streamingText && (
          <Box>
            <Text>{renderMarkdown(streamingText)}</Text>
          </Box>
        )}

        {/* 处理中指示器 */}
        {isProcessing && !streamingText && (
          <Box>
            <Spinner type="dots" />
            <Text color="gray"> Thinking...</Text>
          </Box>
        )}
      </Box>

      {/* 底部状态栏 */}
      <Box paddingX={1} borderStyle="single" borderTop={true} borderColor="gray">
        <Box justifyContent="space-between" width="100%">
          <Text color="gray">{`❯ ${agent} · ${model}`}</Text>
          <Text color="gray">{`${globalToolRegistry.list().length} tools`}</Text>
        </Box>
      </Box>

      {/* 输入框 */}
      <Box paddingX={1}>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          placeholder={isProcessing ? 'Processing...' : 'Type a message...'}
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

  // 检查是否支持 Ink（需要 TTY）
  if (process.stdin.isTTY) {
    render(<App config={config} llm={llm} loop={loop} />)
  } else {
    // 回退到简单模式
    await runSimpleMode(config, llm, loop)
  }
}

// 简单模式（非 TTY 环境）
async function runSimpleMode(config: any, llm: LLMProvider, loop: CoreLoop): Promise<void> {
  const readline = await import('readline')
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  console.log(`
${c.cyan}${c.bold}  _      _     ___  ___  ____
 | |    | |   / _ \\/ _ \\|  _ \\
 | |    | |  | |_| | |_| | | | |
 | |___ | |__|  __/|  __/| |_| |
 |_____|_____|\\___/|____/|____/${c.reset}
${c.gray}           谋定而后动${c.reset}
${c.gray}────────────────────────────────────────${c.reset}
${c.gray} ${globalToolRegistry.list().length} tools · ${config.llm.model}${c.reset}
`)

  const ask = (): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(`${c.cyan}❯ ${c.reset}`, (answer) => {
        resolve(answer)
      })
    })
  }

  if (!process.stdin.isTTY) {
    const lines: string[] = []
    rl.on('line', (line) => lines.push(line))
    rl.on('close', async () => {
      const input = lines[0] || ''
      if (!input.trim()) return

      console.log()
      try {
        const result = await loop.run({
          sessionId: crypto.randomUUID(),
          userInput: input,
          effortLevel: 1,
          phase: 'OBSERVE',
          cwd: process.cwd(),
          llm,
          onPhaseChange: () => {},
          onStreamText: (text) => process.stdout.write(renderMarkdown(text)),
        })
        console.log(`\n${c.gray}────────────────────────────────────────${c.reset}\n`)
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e)
        console.error(`\n${c.red}✗ ${error}${c.reset}\n`)
      }
    })
    return
  }

  while (true) {
    const input = await ask()
    if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
      console.log(`\n${c.gray}再见！${c.reset}\n`)
      break
    }
    if (!input.trim()) continue

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
      })
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
