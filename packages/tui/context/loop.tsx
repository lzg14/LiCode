import { createContext, useContext, createSignal, onMount, type JSX, type Accessor } from "solid-js"
import type { Phase } from "../../core/types"
import type { CoreLoop } from "../../core/loop"

export interface Message {
  id: string
  role: "user" | "assistant" | "system" | "tool"
  content: string
  timestamp: number
  toolName?: string
  toolArgs?: Record<string, unknown>
  toolStatus?: "pending" | "running" | "completed" | "error"
  toolBatch?: number
  duration?: number
}

type AddMessageInput = {
  role: Message["role"]
  content: string
  id?: string
  toolName?: string
  toolArgs?: Record<string, unknown>
  toolStatus?: "pending" | "running" | "completed" | "error"
  toolBatch?: number
  duration?: number
}

export interface LoopContext {
  run: (input: string) => Promise<void>
  abort: () => void
  phase: Accessor<Phase>
  isProcessing: Accessor<boolean>
  pendingCount: Accessor<number>
  elapsed: Accessor<number>
  streamingText: Accessor<string>
  messages: Accessor<Message[]>
  addMessage: (msg: AddMessageInput) => void
  clearMessages: () => void
  toolCallExpanded: Accessor<boolean>
  toggleToolCallExpanded: () => void
  llmCallCount: Accessor<number>
  llmTokenUsage: Accessor<{ input: number; output: number; total: number }>
  compactSession: () => Promise<void>
}

const Ctx = createContext<LoopContext>()

export function LoopProvider(props: { children: JSX.Element; loop: CoreLoop; model: any; sessionId?: string }) {
  const [phase, setPhase] = createSignal<Phase>("OBSERVE")
  const [isProcessing, setIsProcessing] = createSignal(false)
  const [elapsed, setElapsed] = createSignal(0)
  const [streamingText, setStreamingText] = createSignal("")
  const [messages, setMessages] = createSignal<Message[]>([])
  const [toolCallExpanded, setToolCallExpanded] = createSignal(false)
  const toggleToolCallExpanded = () => setToolCallExpanded(prev => !prev)
  const [llmCallCount, setLlmCallCount] = createSignal(0)
  const [llmTokenUsage, setLlmTokenUsage] = createSignal({ input: 0, output: 0, total: 0 })

  const [pendingCount, setPendingCount] = createSignal(0)
  const inputQueue: string[] = []
  let toolCallIdCounter = 0
  const toolStartTimes = new Map<string, number>()
  let abortController: AbortController | null = null
  const abort = () => { abortController?.abort() }

  // 持久化 session ID，跨轮对话复用同一个 session
  let persistentSessionId: string | undefined = props.sessionId

  onMount(() => {
    if (props.sessionId && props.loop) {
      try {
        const history = props.loop.getSessionMessages(props.sessionId)
        if (history.length > 0) {
          setMessages(history
            .filter(m => m.role === 'user' || m.role === 'assistant')
            .map((m, i) => ({
              id: `hist_${i}`,
              role: m.role as "user" | "assistant",
              content: m.content,
              timestamp: Date.now() - (history.length - i) * 1000,
            }))
          )
        }
      } catch {
      }
    }
  })

  const addMessage = (input: AddMessageInput) => {
    const id = input.id ?? crypto.randomUUID()
    const msg: Message = {
      id,
      role: input.role,
      content: input.content,
      timestamp: Date.now(),
      toolName: input.toolName,
      toolArgs: input.toolArgs,
      toolStatus: input.toolStatus,
      duration: input.duration,
    }
    setMessages((prev) => [...prev, msg])
  }

  const clearMessages = () => {
    setMessages([])
    setStreamingText("")
  }

  const run = async (input: string): Promise<void> => {
    if (isProcessing()) {
      inputQueue.push(input)
      setPendingCount(inputQueue.length)
      return
    }

    abortController = new AbortController()
    addMessage({ role: "user", content: input })
    setLlmCallCount(0)
    setLlmTokenUsage({ input: 0, output: 0, total: 0 })
    setIsProcessing(true)
    setPhase("OBSERVE")
    setStreamingText("")

    let streamingBuffer = ""
    const startTime = Date.now()

    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000))
    }, 1000)

    try {
      // 首次运行时创建 session，后续复用
      if (!persistentSessionId) {
        persistentSessionId = crypto.randomUUID()
      }
      const ctx = {
        sessionId: persistentSessionId,
        userInput: input,
        signal: abortController.signal,
        effortLevel: 1,
        phase: "OBSERVE" as Phase,
        cwd: process.cwd(),
        model: props.model,
        onPhaseChange: (p: Phase) => {
          setPhase(p)
        },
        onPhaseLog: (text: string) => {
          addMessage({ role: "system", content: text.trimEnd() })
        },
        onLLMCall: () => {
          setLlmCallCount(prev => prev + 1)
        },
        onLLMResult: (usage: { inputTokens: number; outputTokens: number; totalTokens: number }) => {
          setLlmTokenUsage(prev => ({
            input: prev.input + usage.inputTokens,
            output: prev.output + usage.outputTokens,
            total: prev.total + usage.totalTokens,
          }))
        },
        onStreamText: (text: string) => {
          streamingBuffer += text
          setStreamingText(streamingBuffer)
        },
        onToolCall: (toolName: string, args: Record<string, unknown>, batch: number) => {
          toolCallIdCounter++
          const id = `tool_${toolCallIdCounter}`
          toolStartTimes.set(id, Date.now())
          addMessage({ id, role: "tool", content: toolName, toolName, toolArgs: args, toolStatus: "running", toolBatch: batch })
        },
        onToolResult: () => {
          setMessages((prev) => {
            const last = prev[prev.length - 1]
            if (last?.role === "tool") {
              const start = toolStartTimes.get(last.id) ?? 0
              const duration = start > 0 ? Date.now() - start : 0
              return [...prev.slice(0, -1), { ...last, toolStatus: "completed", duration }]
            }
            return prev
          })
        },
      }

      const result = await props.loop.run(ctx)

      if (result.sessionId) {
        persistentSessionId = result.sessionId
      }

      if (result.text) {
        addMessage({
          role: "assistant",
          content: result.text,
          duration: Math.floor((Date.now() - startTime) / 1000),
        })
      }
      setPhase("DONE")
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      addMessage({ role: "system", content: `错误: ${error}` })
      setPhase("DONE")
    } finally {
      abortController = null
      setIsProcessing(false)
      setStreamingText("")
      clearInterval(timer)
      setElapsed(0)

      // 处理队列中下一个输入
      if (inputQueue.length > 0) {
        const next = inputQueue.shift()!
        setPendingCount(inputQueue.length)
        run(next)
      }
    }
  }

  const compactSession = async () => {
    if (!persistentSessionId) {
      addMessage({ role: "system", content: "没有活跃的 session" })
      return
    }
    addMessage({ role: "system", content: "正在压缩对话历史..." })
    try {
      const result = await props.loop.compactSession(persistentSessionId)
      if (result) {
        addMessage({ role: "system", content: result.saved > 0 ? `压缩完成，节省 ${result.saved} 条消息` : result.summary })
      }
    } catch (e) {
      addMessage({ role: "system", content: `压缩失败: ${e instanceof Error ? e.message : String(e)}` })
    }
  }

  const value: LoopContext = {
    run,
    abort,
    phase,
    isProcessing,
    pendingCount,
    elapsed,
    streamingText,
    messages,
    addMessage,
    clearMessages,
    toolCallExpanded,
    toggleToolCallExpanded,
    llmCallCount,
    llmTokenUsage,
    compactSession,
  }
  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>
}

export function useLoop(): LoopContext {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useLoop: missing LoopProvider")
  return ctx
}
