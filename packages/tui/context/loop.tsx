import { createContext, useContext, createSignal, createMemo, onMount, type JSX, type Accessor } from "solid-js"
import type { Phase } from "../../core/types"
import type { CoreLoop } from "../../core/loop"
import { createModel } from "../../llm/provider"
import { listModelsByProvider } from "../../llm/catalog"
import { devLogger } from "../../core/dev-logger"
import { WorkflowEngine, BuiltinScriptRegistry } from "../../workflow"
import { readImageFile } from "../../tools/builtin"
import { checkDangerousPattern } from "../../security"

/** 解析用户输入中的图片引用（@/path/to/image.png 或 @C:\path\to\image.png） */
function parseImageRefs(text: string): { text: string; images: Array<{ base64: string; mimeType: string }> } {
  const images: Array<{ base64: string; mimeType: string }> = []
  // 匹配 @ 后跟文件路径（支持绝对路径、相对路径、~ 路径）
  const cleaned = text.replace(/@(\S+\.(?:png|jpe?g|gif|webp|bmp|svg))/gi, (_, filePath: string) => {
    const resolved = filePath.startsWith('~')
      ? filePath.replace(/^~/, process.env.HOME || process.env.USERPROFILE || '')
      : filePath
    const img = readImageFile(resolved)
    if (img) {
      images.push(img)
      return `[图片: ${filePath}]`
    }
    return `@${filePath}`
  })
  return { text: cleaned, images }
}

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
  /** 队列中等待发送的 user 消息 */
  queued?: boolean
  /** 附带的图片列表（base64 + mimeType），用于 multimodal 消息 */
  images?: Array<{ base64: string; mimeType: string }>
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
  queued?: boolean
  images?: Message["images"]
}

export interface LoopContext {
  run: (input: string, images?: Array<{ base64: string; mimeType: string }>) => Promise<void>
  abort: () => void
  phase: Accessor<Phase>
  isProcessing: Accessor<boolean>
  pendingCount: Accessor<number>
  elapsed: Accessor<number>
  streamingText: Accessor<string>
  messages: Accessor<Message[]>
  addMessage: (msg: AddMessageInput) => void
  updateMessage: (id: string, patch: Partial<Message>) => void
  clearMessages: () => void
  toolCallExpanded: Accessor<boolean>
  toggleToolCallExpanded: () => void
  llmCallCount: Accessor<number>
  llmTokenUsage: Accessor<{ input: number; output: number; total: number }>
  compactSession: () => Promise<void>
  runWorkflow: (name: string, args: any) => Promise<any>
  listWorkflows: () => string[]
  activeSkill: Accessor<string | null>
  setActiveSkill: (name: string | null) => void
  currentModel: Accessor<string>
  currentProvider: Accessor<string>
  switchModel: (modelId: string) => void
  switchProvider: (providerId: string) => void
  getAvailableModels: () => string[]
  getAvailableProviders: () => string[]
  contextTokens: Accessor<number>
}

const Ctx = createContext<LoopContext>()

export function LoopProvider(props: { children: JSX.Element; loop: CoreLoop; model: any; provider?: string; sessionId?: string; llmConfig?: { provider: string; model: string; apiKey?: string; baseUrl?: string } }) {
  const [phase, setPhase] = createSignal<Phase>("OBSERVE")
  const [isProcessing, setIsProcessing] = createSignal(false)
  const [elapsed, setElapsed] = createSignal(0)
  const [streamingText, setStreamingText] = createSignal("")
  const [messages, setMessages] = createSignal<Message[]>([])
  const [toolCallExpanded, setToolCallExpanded] = createSignal(false)
  const toggleToolCallExpanded = () => setToolCallExpanded(prev => !prev)
  const [llmCallCount, setLlmCallCount] = createSignal(0)
  const [llmTokenUsage, setLlmTokenUsage] = createSignal({ input: 0, output: 0, total: 0 })
  const [currentModel, setCurrentModel] = createSignal(props.model?.modelId ?? "unknown")
  const [currentProvider, setCurrentProvider] = createSignal(props.provider ?? "deepseek")
  const [activeSkill, setActiveSkillState] = createSignal<string | null>(null)
  const [activeSkillInstructions, setActiveSkillInstructions] = createSignal<string | null>(null)

  const [pendingCount, setPendingCount] = createSignal(0)
  const inputQueue: { id: string; text: string }[] = []
  let toolCallIdCounter = 0
  const toolStartTimes = new Map<string, number>()
  let abortController: AbortController | null = null
  const abort = () => {
    abortController?.abort()
    // 清空队列
    inputQueue.length = 0
    setPendingCount(0)
  }
  let activeModel: any = props.model
  // 工具调用轮次上限确认机制
  let confirmResolve: ((value: boolean) => void) | null = null

  // Workflow 引擎
  const wfEngine = new WorkflowEngine({
    maxConcurrentAgents: 3,
    maxDepth: 2,
    timeoutMs: 600_000,
    cwd: process.cwd(),
    llmProvider: props.model
      ? {
          modelId: props.model.modelId ?? currentModel(),
          complete: async (req) => {
            // 把 LLM 调用代理到当前模型
            const { generateText } = await import("ai")
            const result = await generateText({
              model: props.model,
              messages: req.messages,
              temperature: req.temperature ?? 0.7,
            })
            return { content: result.text }
          },
        }
      : undefined,
    toolExecutor: async (name, input) => {
      const { globalToolRegistry } = await import("../../tools/registry")

      // 危险命令二次确认
      if (name === 'bash') {
        const parsed = input as { command?: string }
        if (parsed.command) {
          const check = checkDangerousPattern(parsed.command)
          if (check.dangerous) {
            // 这里简化处理，实际应该弹出 Dialog 让用户确认
            // 目前先拒绝危险命令
            return { success: false, error: `危险命令被拒绝: ${check.reason}` }
          }
        }
      }

      return globalToolRegistry.execute(name, input) as Promise<{ success: boolean; output?: any; error?: string }>
    },
    scriptRegistry: new BuiltinScriptRegistry(),
  })

  const runWorkflow = async (name: string, args: any) => {
    const result = await wfEngine.run({ name, args })
    return result
  }

  const listWorkflows = (): string[] => wfEngine["config"]?.scriptRegistry?.list() ?? ["coding", "research", "review"]

  const setActiveSkill = async (name: string | null) => {
    if (!name) {
      setActiveSkillState(null)
      setActiveSkillInstructions(null)
      return
    }
    try {
      const { readFile } = await import("fs/promises")
      const { join } = await import("path")
      const homes = process.env.HOME || process.env.USERPROFILE || ""
      const paths = [
        join(homes, ".licode", "skills", `${name}.skill.md`),
        join(homes, ".licode", "skills", `${name}.skill.json`),
        join(homes, ".licode", "skills", `${name}.md`),
        join(homes, ".licode", "skills", "builtin", `${name}.skill.md`),
        join(homes, ".licode", "skills", "builtin", `${name}.skill.json`),
        join(process.cwd(), "skills", `${name}.skill.md`),
        join(process.cwd(), "skills", `${name}.skill.json`),
      ]
      for (const p of paths) {
        try {
          const content = await readFile(p, "utf-8")
          // 如果是 JSON 格式，提取 instructions 字段
          if (p.endsWith('.json')) {
            const data = JSON.parse(content)
            setActiveSkillState(name)
            setActiveSkillInstructions(data.instructions ?? content)
          } else {
            setActiveSkillState(name)
            setActiveSkillInstructions(content)
          }
          return
        } catch {}
      }
      setActiveSkillState(name)
      setActiveSkillInstructions(`# ${name}\n\n技能文件未找到。已搜索: ${paths.join(", ")}`)
    } catch (e) {
      devLogger.debug("SKILL", "load failed", e)
    }
  }

  const switchModel = (modelId: string) => {
    const cfg = props.llmConfig
    activeModel = createModel({
      provider: cfg?.provider ?? currentProvider(),
      model: modelId,
      apiKey: cfg?.apiKey,
      baseUrl: cfg?.baseUrl,
    })
    setCurrentModel(modelId)
  }

  const switchProvider = (providerId: string) => {
    const models = listModelsByProvider(providerId)
    if (models.length === 0) return
    const cfg = props.llmConfig
    activeModel = createModel({
      provider: providerId,
      model: models[0],
      apiKey: cfg?.apiKey,
      baseUrl: cfg?.baseUrl,
    })
    setCurrentProvider(providerId)
    setCurrentModel(models[0])
  }

  const getAvailableModels = (): string[] => {
    return listModelsByProvider(currentProvider())
  }

  const getAvailableProviders = (): string[] => {
    const all = ["anthropic", "openai", "deepseek", "MiniMax"] as const
    return all.filter(p => listModelsByProvider(p).length > 0)
  }

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
      queued: input.queued,
      images: input.images,
    }
    setMessages((prev) => [...prev, msg])
  }

  const updateMessage = (id: string, patch: Partial<Message>) => {
    setMessages((prev) => prev.map(m => m.id === id ? { ...m, ...patch } : m))
  }

  const clearMessages = () => {
    setMessages([])
    setStreamingText("")
  }

  const run = async (input: string, clipboardImages?: Array<{ base64: string; mimeType: string }>): Promise<void> => {
    // 如果正在等待用户确认是否继续 tool call 迭代
    if (confirmResolve) {
      const shouldContinue = input.trim().toLowerCase() === "y"
      const resolve = confirmResolve
      confirmResolve = null
      setIsProcessing(true)
      addMessage({ role: "system", content: shouldContinue ? "继续执行..." : "停止工具调用" })
      resolve(shouldContinue)
      return
    }

    if (isProcessing()) {
      // 记录到 inputQueue 等待后续发送
      const msgId = `queued_${++toolCallIdCounter}`
      inputQueue.push({ id: msgId, text: input })
      setPendingCount(inputQueue.length)
      // 同步插入 message-list，标记 queued（显示在对话列表底部）
      addMessage({ id: msgId, role: "user", content: input, queued: true })
      return
    }

    // 解析用户输入中的图片引用（@/path/to/image.png）
    const { text: cleanText, images: parsedImages } = parseImageRefs(input)
    // 合并剪贴板图片 + 文件引用图片
    const allImages = [...parsedImages, ...(clipboardImages ?? [])]

    abortController = new AbortController()
    addMessage({ role: "user", content: cleanText, images: allImages.length > 0 ? allImages : undefined })
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
        userInput: cleanText,
        userImages: allImages.length > 0 ? allImages : undefined,
        signal: abortController.signal,
        effortLevel: 1,
        phase: "OBSERVE" as Phase,
        cwd: process.cwd(),
        model: activeModel,
        activeSkill: activeSkill() ?? undefined,
        activeSkillInstructions: activeSkillInstructions() ?? undefined,
        onPhaseChange: (p: Phase) => {
          setPhase(p)
        },
        onPhaseLog: (text: string) => {
          devLogger.info('PHASE', text.trimEnd())
        },
        onLLMCall: () => {
          setLlmCallCount(prev => prev + 1)
        },
        onLLMResult: (usage: { inputTokens: number; outputTokens: number; totalTokens: number }) => {
          // 显示当前请求的上下文（不是累加）— inputTokens 本身已包含完整历史
          setLlmTokenUsage({
            input: usage.inputTokens,
            output: usage.outputTokens,
            total: usage.inputTokens + usage.outputTokens,
          })
        },
        onStreamText: (text: string) => {
          streamingBuffer += text
          setStreamingText(streamingBuffer)
        },
        onIntermediateText: (text: string) => {
          addMessage({ role: "assistant", content: text })
          streamingBuffer = ""
          setStreamingText("")
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
        onConfirmContinue: () => {
          return new Promise<boolean>((resolve) => {
            confirmResolve = resolve
            addMessage({ role: "system", content: "已达最大迭代次数。输入 y 继续，其他任意键停止。" })
            setStreamingText("")
            streamingBuffer = ""
            // 临时解除 processing 以允许用户输入
            setIsProcessing(false)
          })
        },
        onCompaction: (summary: string, originalCount: number, preservedCount: number) => {
          addMessage({ role: "system", content: `🗜️ 已压缩对话历史：${originalCount} 条 → 保留 ${preservedCount} 条\n\n摘要预览：\n${summary.slice(0, 500)}${summary.length > 500 ? '...' : ''}` })
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
      // AbortError 是用户主动取消，不显示错误
      if (!error.includes('abort') && !error.includes('Abort')) {
        addMessage({ role: "system", content: `错误: ${error}` })
      }
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
        // 把已经发出过的 user 消息 queued 标记去掉
        updateMessage(next.id, { queued: false })
        run(next.text)
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

  // 估算当前上下文的 token 数（总字符数 / 3，中英文混合粗略估）
  const contextTokens = createMemo(() => {
    let totalChars = 0
    for (const msg of messages()) {
      totalChars += msg.content.length
      if (msg.toolArgs) totalChars += JSON.stringify(msg.toolArgs).length
    }
    return Math.ceil(totalChars / 3)
  })

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
    updateMessage,
    clearMessages,
    toolCallExpanded,
    toggleToolCallExpanded,
    llmCallCount,
    llmTokenUsage,
    compactSession,
    runWorkflow,
    listWorkflows,
    currentModel,
    currentProvider,
    switchModel,
    switchProvider,
    getAvailableModels,
    getAvailableProviders,
    contextTokens,
    activeSkill,
    setActiveSkill,
  }
  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>
}

export function useLoop(): LoopContext {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useLoop: missing LoopProvider")
  return ctx
}
