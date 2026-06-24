import { createContext, useContext, createSignal, createMemo, onMount, batch, type JSX, type Accessor } from "solid-js"
import type { Phase } from "../../core/types"
import type { CoreLoop } from "../../core/loop"
import { createModel } from "../../llm/provider"
import { listModelsByProvider } from "../../llm/catalog"
import { devLogger } from "../../core/dev-logger"
import { readImageFile } from "../../tools/builtin"
import { checkDangerousPattern } from "../../security"
import { createStreamAccumulator, type Segment } from "../util/stream-accumulator"
import { useToast } from "../ui/toast"
import { Scheduler } from "../../core/scheduler"

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
  /** 工具执行产生的 diff */
  diff?: string
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
  diff?: string
  queued?: boolean
  images?: Message["images"]
}

export interface LoopContext {
  run: (input: string, opts?: { clipboardImages?: Array<{ base64: string; mimeType: string }> }) => Promise<void>
  abort: () => void
  isProcessing: Accessor<boolean>
  pendingCount: Accessor<number>
  elapsed: Accessor<number>
  messages: Accessor<Message[]>
  streamingSegments: Accessor<Segment[]>
  pendingText: Accessor<string>
  streamMode: Accessor<'text' | 'in-thinking' | 'in-system-reminder'>
  addMessage: (msg: AddMessageInput) => void
  updateMessage: (id: string, patch: Partial<Message>) => void
  clearMessages: () => void
  clearSession: () => void
  toolCallExpanded: Accessor<boolean>
  toggleToolCallExpanded: () => void
  llmCallCount: Accessor<number>
  llmTokenUsage: Accessor<{ input: number; output: number; total: number }>
  compactSession: () => Promise<void>
  listSkills: () => Promise<string[]>
  activeSkill: Accessor<string | null>
  setActiveSkill: (name: string | null) => void
  currentModel: Accessor<string>
  currentProvider: Accessor<string>
  switchModel: (modelId: string) => void
  switchProvider: (providerId: string) => void
  getAvailableModels: () => string[]
  getAvailableProviders: () => string[]
  contextTokens: Accessor<number>
  addLoop: (interval: string, prompt: string) => string | null
  stopLoops: () => void
  listLoops: () => void
  scheduler: Scheduler
  currentPhase: Accessor<string>
  verifyResults: Accessor<Array<{ passed: boolean; message?: string }>>
}

const Ctx = createContext<LoopContext>()

export function LoopProvider(props: { children: JSX.Element; loop: CoreLoop; model: any; provider?: string; sessionId?: string; llmConfig?: { provider: string; model: string; apiKey?: string; baseUrl?: string } }) {
  const toast = useToast()
  const [isProcessing, setIsProcessing] = createSignal(false)
  const [elapsed, setElapsed] = createSignal(0)
  const [messages, setMessages] = createSignal<Message[]>([])
  const [toolCallExpanded, setToolCallExpanded] = createSignal(false)
  const toggleToolCallExpanded = () => setToolCallExpanded(prev => !prev)
  const [llmCallCount, setLlmCallCount] = createSignal(0)
  const [llmTokenUsage, setLlmTokenUsage] = createSignal({ input: 0, output: 0, total: 0 })
  const [currentModel, setCurrentModel] = createSignal(props.model?.modelId ?? "unknown")
  const [currentProvider, setCurrentProvider] = createSignal(props.provider ?? "deepseek")
  const [activeSkill, setActiveSkillState] = createSignal<string | null>(null)
  const [activeSkillInstructions, setActiveSkillInstructions] = createSignal<string | null>(null)
  // VERIFY 阶段状态
  const [currentPhase, setCurrentPhase] = createSignal<string>("EXECUTE")
  const [verifyResults, setVerifyResults] = createSignal<Array<{ passed: boolean; message?: string }>>([])

  const [pendingCount, setPendingCount] = createSignal(0)
  const [streamingSegments, setStreamingSegments] = createSignal<Segment[]>([])
  const [pendingText, setPendingText] = createSignal("")
  const [streamMode, setStreamMode] = createSignal<'text' | 'in-thinking' | 'in-system-reminder'>('text')
  let streamAccumulator = createStreamAccumulator()
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

  // MCP 集成
  const initMCP = async () => {
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('MCP init timeout')), 5000))
    try {
      await Promise.race([initMCPCore(), timeout])
    } catch (e) {
      devLogger.info('MCP', `Init skipped: ${e}`)
    }
  }

  const initMCPCore = async () => {
    try {
      const { configLoader } = await import("../../config")
      const config = configLoader.getConfig()
      const mcpConfig = config?.mcp?.mcpServers
      if (!mcpConfig || Object.keys(mcpConfig).length === 0) return

      const { MCPIntegration } = await import("../../integration/mcp")
      const { globalToolRegistry } = await import("../../tools/registry")

      for (const [id, serverConfig] of Object.entries(mcpConfig)) {
        try {
          const mcp = new MCPIntegration(serverConfig as any)
          await mcp.connect()
          const tools = await mcp.discoverTools()

          // 注册 MCP 工具到 globalToolRegistry
          for (const tool of tools) {
            const toolName = `mcp__${id}__${tool.name}`
            // MCP 工具的 inputSchema 是 JSON Schema，用 z.any() 透传
            // AI SDK 会用这个 schema 构建 tool 定义，z.any() 接受任意输入
            const inputSchema = await import("zod").then(z => z.z.any())
            globalToolRegistry.register({
              name: toolName,
              description: `[MCP: ${id}] ${tool.description ?? tool.name}`,
              inputSchema,
              handler: async (input: any) => {
                const result = await mcp.callTool(tool.name, input)
                const parts: string[] = []
                for (const c of result.content ?? []) {
                  if (c.type === 'text') {
                    parts.push(c.text ?? '')
                  } else if (c.type === 'image') {
                    parts.push(`[图片: ${c.mimeType ?? 'unknown'}]`)
                  } else if (c.type === 'resource') {
                    parts.push(`[资源: ${c.uri ?? 'unknown'}]`)
                  } else {
                    parts.push(`[${c.type ?? 'unknown'}]`)
                  }
                }
                return {
                  success: !result.isError,
                  output: parts.join('\n') || '(空结果)',
                }
              },
            })
          }

          devLogger.info('MCP', `Registered ${tools.length} tools from ${id}`)
        } catch (e) {
          devLogger.info('MCP', `Failed to connect ${id}: ${e}`)
        }
      }
    } catch (e) {
      devLogger.info('MCP', `Init failed: ${e}`)
    }
  }
  initMCP()

  const setActiveSkill = async (name: string | null) => {
    if (!name) {
      setActiveSkillState(null)
      setActiveSkillInstructions(null)
      return
    }
    try {
      const { findSkill, loadAllSkills } = await import("../../skills/loader")
      const skill = await findSkill(name, process.cwd())
      if (skill) {
        setActiveSkillState(name)
        setActiveSkillInstructions(skill.instructions)
      } else {
        const all = await loadAllSkills(process.cwd())
        const available = all.map(s => s.name).join(', ')
        addMessage({ role: 'system', content: `未找到 skill: ${name}\n可用: ${available || '(无)'}` })
      }
    } catch (e) {
      devLogger.debug("SKILL", "load failed", e)
    }
  }

  const listSkills = async (): Promise<string[]> => {
    try {
      const { loadAllSkills } = await import("../../skills/loader")
      const all = await loadAllSkills(process.cwd())
      return all.map(s => s.name)
    } catch {
      return []
    }
  }

  const switchModel = async (modelId: string) => {
    const cfg = props.llmConfig
    activeModel = await createModel({
      provider: cfg?.provider ?? currentProvider(),
      model: modelId,
      apiKey: cfg?.apiKey,
      baseUrl: cfg?.baseUrl,
    })
    setCurrentModel(modelId)
  }

  const switchProvider = async (providerId: string) => {
    const models = listModelsByProvider(providerId)
    if (models.length === 0) return
    const cfg = props.llmConfig
    activeModel = await createModel({
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
        const modelMsgs = props.loop.getSessionModelMessages(props.sessionId)
        if (modelMsgs.length === 0) return

        const restored: Message[] = []
        let idx = 0
        let toolBatch = 0

        for (const raw of modelMsgs) {
          if (raw.role === 'user' || raw.role === 'assistant') {
            let text = ''
            if (Array.isArray(raw.content)) {
              for (const part of raw.content) {
                if (part.type === 'text') text += part.text
              }
            } else if (typeof raw.content === 'string') {
              text = raw.content
            }
            if (!text.trim()) continue

            restored.push({
              id: `hist_${idx++}`,
              role: raw.role as 'user' | 'assistant',
              content: text,
              timestamp: Date.now(),
            })

            if (raw.role === 'assistant' && Array.isArray(raw.content)) {
              const toolCalls = raw.content.filter(p => p.type === 'tool-call')
              if (toolCalls.length > 0) toolBatch++
              for (const tc of toolCalls) {
                restored.push({
                  id: `tool_hist_${idx++}`,
                  role: 'tool',
                  content: tc.toolName ?? '',
                  toolName: tc.toolName ?? '',
                  toolArgs: tc.input ?? {},
                  toolStatus: 'completed' as const,
                  toolBatch,
                  timestamp: Date.now(),
                })
              }
            }
          }
        }

        if (restored.length > 0) {
          setMessages(restored)
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
  }

  const clearSession = () => {
    setMessages([])
    persistentSessionId = undefined
    setLlmCallCount(0)
    setLlmTokenUsage({ input: 0, output: 0, total: 0 })
    setActiveSkillState(null)
    setActiveSkillInstructions(null)
    addMessage({ role: "system", content: "已开新会话" })
  }

  const run = async (input: string, opts?: { clipboardImages?: Array<{ base64: string; mimeType: string }> }): Promise<void> => {
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
    const allImages = [...parsedImages, ...(opts?.clipboardImages ?? [])]

    abortController = new AbortController()
    addMessage({ role: "user", content: cleanText, images: allImages.length > 0 ? allImages : undefined })
    setLlmCallCount(0)
    setLlmTokenUsage({ input: 0, output: 0, total: 0 })
    setIsProcessing(true)
    setCurrentPhase('EXECUTE')
    setVerifyResults([])
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
        phase: "EXECUTE" as Phase,
        cwd: process.cwd(),
        model: activeModel,
        activeSkill: activeSkill() ?? undefined,
        activeSkillInstructions: activeSkillInstructions() ?? undefined,
        onPhaseChange: (phase: string) => {
          setCurrentPhase(phase)
        },
        onPhaseLog: (text: string) => {
          devLogger.info('PHASE', text.trimEnd())
          // 解析 VERIFY 结果
          if (text.startsWith('✓') || text.startsWith('✗')) {
            setVerifyResults(prev => [...prev, {
              passed: text.startsWith('✓'),
              message: text.slice(2).trim()
            }])
          }
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
        onStreamText: (delta: string) => {
          const { closed, pending, mode } = streamAccumulator.push(delta)
          batch(() => {
            setStreamMode(mode)
            if (closed.length > 0) {
              setStreamingSegments(prev => [...prev, ...closed])
            }
            if (pending !== pendingText()) {
              setPendingText(pending)
            }
          })
        },
        onIntermediateText: (text: string) => {
          // 中间轮一次性把当前段收尾，然后整个块作为新消息
          streamAccumulator.reset()
          setStreamingSegments([])
          setPendingText("")
          addMessage({ role: "assistant", content: text })
        },
        onToolCall: (toolName: string, args: Record<string, unknown>, batch: number) => {
          toolCallIdCounter++
          const id = `tool_${toolCallIdCounter}`
          toolStartTimes.set(id, Date.now())
          addMessage({ id, role: "tool", content: toolName, toolName, toolArgs: args, toolStatus: "running", toolBatch: batch })
        },
        onToolResult: (result: any) => {
          setMessages((prev) => {
            const last = prev[prev.length - 1]
            if (last?.role === "tool") {
              const start = toolStartTimes.get(last.id) ?? 0
              const duration = start > 0 ? Date.now() - start : 0
              const diff = result?.diff
              return [...prev.slice(0, -1), { ...last, toolStatus: "completed", duration, diff }]
            }
            return prev
          })
        },
        onConfirmContinue: () => {
          return new Promise<boolean>((resolve) => {
            confirmResolve = resolve
            addMessage({ role: "system", content: "已达最大迭代次数。输入 y 继续，其他任意键停止。" })
            // 临时解除 processing 以允许用户输入
            setIsProcessing(false)
          })
        },
        onCompaction: (summary: string, originalCount: number, preservedCount: number) => {
          addMessage({ role: "system", content: `🗜️ 已压缩对话历史：${originalCount} 条 → 保留 ${preservedCount} 条\n\n摘要预览：\n${summary.slice(0, 500)}${summary.length > 500 ? '...' : ''}` })
          const saved = originalCount - preservedCount
          toast.show({
            message: `已压缩 ${saved} 条历史，保留最近 ${preservedCount} 条`,
            variant: "info",
            duration: 5000,
          })
        },
      }

      const result = await props.loop.run(ctx)

      if (result.sessionId) {
        persistentSessionId = result.sessionId
      }

      if (result.text) {
        // 清空 streaming 状态，避免重复显示
        streamAccumulator.reset()
        setStreamingSegments([])
        setPendingText("")
        
        addMessage({
          role: "assistant",
          content: result.text,
          duration: Math.floor((Date.now() - startTime) / 1000),
        })
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      // AbortError 是用户主动取消，不显示错误
      if (!error.includes('abort') && !error.includes('Abort')) {
        addMessage({ role: "system", content: `错误: ${error}` })
      }
    } finally {
      abortController = null
      setIsProcessing(false)
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
        if (result.summary) {
          // 显示摘要内容
          const tag = result.wasFallback ? '[规则提取]' : '[LLM 摘要]'
          const preview = result.summary.length > 200 ? result.summary.slice(0, 200) + '...' : result.summary
          addMessage({ role: "system", content: `🗜️ 已压缩 ${result.originalCount} 条 → 保留 ${result.preservedCount} 条\n\n${tag}\n${preview}` })
        } else {
          addMessage({ role: "system", content: result.saved > 0 ? `压缩完成，节省 ${result.saved} 条消息` : "无需压缩" })
        }
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

  // ===== /loop 定时执行 =====
  const scheduler = new Scheduler({
    onTrigger: async (prompt: string) => {
      await run(prompt)
    },
    onLog: (msg: string) => {
      addMessage({ role: "system", content: msg })
    },
  })

  const addLoop = (interval: string, prompt: string): string | null => {
    const ms = scheduler.parseInterval(interval)
    if (!ms) {
      addMessage({ role: "system", content: `无效的时间格式: ${interval}。支持: 30s, 5m, 2h, 1d` })
      return null
    }
    const id = scheduler.create(ms, prompt)
    addMessage({ role: "system", content: `循环已启动 (ID: ${id})\n间隔: ${interval}\nPrompt: ${prompt}\n输入 /loop stop 停止` })
    return id
  }

  const stopLoops = () => {
    const count = scheduler.deleteAll()
    addMessage({ role: "system", content: count > 0 ? `已停止 ${count} 个循环` : "没有运行中的循环" })
  }

  const listLoops = () => {
    const tasks = scheduler.list()
    if (tasks.length === 0) {
      addMessage({ role: "system", content: "没有运行中的循环" })
      return
    }
    const lines = tasks.map(t => {
      const mins = Math.round(t.intervalMs / 60_000)
      return `  ${t.id} | 每 ${mins}m | 已执行 ${t.runCount} 次 | ${t.prompt}`
    })
    addMessage({ role: "system", content: `运行中的循环 (${tasks.length}):\n${lines.join('\n')}` })
  }

  const value: LoopContext = {
    run,
    abort,
    isProcessing,
    pendingCount,
    elapsed,
    messages,
    streamingSegments,
    pendingText,
    streamMode,
    addMessage,
    updateMessage,
    clearMessages,
    clearSession,
    toolCallExpanded,
    toggleToolCallExpanded,
    llmCallCount,
    llmTokenUsage,
    compactSession,
    listSkills,
    currentModel,
    currentProvider,
    switchModel,
    switchProvider,
    getAvailableModels,
    getAvailableProviders,
    contextTokens,
    activeSkill,
    setActiveSkill,
    addLoop,
    stopLoops,
    listLoops,
    scheduler,
    currentPhase,
    verifyResults,
  }
  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>
}

export function useLoop(): LoopContext {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useLoop: missing LoopProvider")
  return ctx
}