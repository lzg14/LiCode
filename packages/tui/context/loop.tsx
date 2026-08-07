/**
 * loop.tsx - 核心状态管理（重构版）
 *
 * 整合各独立 context：
 * - message.tsx: 消息状态
 * - loop-model.tsx: 模型状态
 * - loop-skill.tsx: Skill 状态
 * - loop-stream.tsx: 流式输出状态
 * - loop-subagent.tsx: Subagent 状态
 * - loop-scheduler.tsx: 定时任务状态
 * - loop-input.tsx: 输入队列状态
 */

import { type Accessor, batch, createContext, createMemo, createSignal, type JSX, onCleanup, onMount, useContext } from "solid-js"
import { devLogger } from "../../core/dev-logger"
import type { CoreLoop } from "../../core/loop"
import { Scheduler } from "../../core/scheduler"
import type { Phase } from "../../core/types"
import { listModelsByProvider } from "../../llm/catalog"
import { createModel } from "../../llm/provider"
import { readImageFile } from "../../tools/builtin"
import { useToast } from "../ui/toast"
import type { SkillIndex } from "../../skills/types"

// 导入各独立 context
import { createMessageState, type Message, type AddMessageInput } from "./message"
import { createModelState } from "./loop-model"
import { createSkillState } from "./loop-skill"
import { createStreamState } from "./loop-stream"
import { createSubagentState } from "./loop-subagent"
import { createSchedulerState } from "./loop-scheduler"
import { createInputState } from "./loop-input"

/** 解析用户输入中的图片引用（@/path/to/image.png 或 @C:\path\to\image.png） */
export function parseImageRefs(text: string): { text: string; images: Array<{ base64: string; mimeType: string }> } {
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

export interface LoopContext {
  run: (input: string, opts?: { clipboardImages?: Array<{ base64: string; mimeType: string }> }) => Promise<void>
  abort: () => void
  isProcessing: Accessor<boolean>
  pendingCount: Accessor<number>
  elapsed: Accessor<number>
  messages: Accessor<Message[]>
  streamingSegments: Accessor<import("./loop-stream").Segment[]>
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
  cumulativeTokens: Accessor<{ input: number; output: number; total: number; turns: number }>
  compactSession: () => Promise<void>
  listSkills: () => Promise<string[]>
  activeSkill: Accessor<string | null>
  activeSkillInstructions: Accessor<string | null>
  setActiveSkill: (name: string | null) => void
  currentModel: Accessor<string>
  currentProvider: Accessor<string>
  effectiveContextWindow: Accessor<number | undefined>
  compactionError: Accessor<Error | null>
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
  subagentStatuses: Accessor<Array<{ id: string; task: string; status: 'running' | 'done' | 'error'; startTime: number; endTime?: number }>>
  subagentOpen: Accessor<boolean>
  setSubagentOpen: (v: boolean | ((prev: boolean) => boolean)) => void
  /** 聚焦输入框 */
  focusInput: () => void
  /** 设置输入框文本 */
  setPromptText: (text: string) => void
  /** 在输入框文本前插入内容 */
  prependPromptText: (text: string) => void
  /** 注册输入框操作函数（Prompt 组件调用） */
  registerInputFns: (fns: { focus: () => void; setText: (text: string) => void; prependText: (text: string) => void }) => void
  /** 清除输入框操作函数（Prompt 组件卸载时调用） */
  unregisterInputFns: () => void
  /** 待确认的 skill 建议 */
  pendingSkillSuggestion: Accessor<Array<{ name: string; description: string; triggerHints: string }> | null>
  /** skill 建议当前选中索引 */
  skillSuggestIdx: Accessor<number>
  /** 设置 skill 建议当前选中索引 */
  setSkillSuggestIdx: (fn: (prev: number) => number) => void
  /** 确认/拒绝 skill 建议 */
  resolveSkillSuggestion: (confirmed: boolean) => void
}

const Ctx = createContext<LoopContext>()

export function LoopProvider(props: { children: JSX.Element; loop: CoreLoop; model: any; provider?: string; sessionId?: string; llmConfig?: { provider: string; model: string; apiKey?: string; baseUrl?: string }; effectiveContextWindow?: number }) {
  const toast = useToast()

  // ===== 初始化各独立 context =====
  const messageState = createMessageState()
  const modelState = createModelState(props.provider ?? "deepseek", props.model?.modelId ?? "unknown")
  const skillState = createSkillState()
  const streamState = createStreamState()
  const subagentState = createSubagentState()
  const schedulerState = createSchedulerState()
  const inputState = createInputState()

  // ===== 本地状态 =====
  const [isProcessing, setIsProcessing] = createSignal(false)
  const [elapsed, setElapsed] = createSignal(0)
  const [toolCallExpanded, setToolCallExpanded] = createSignal(false)
  const toggleToolCallExpanded = () => setToolCallExpanded(prev => !prev)
  const [llmCallCount, setLlmCallCount] = createSignal(0)
  const [llmTokenUsage, setLlmTokenUsage] = createSignal({ input: 0, output: 0, total: 0 })
  const [cumulativeTokens, setCumulativeTokens] = createSignal({ input: 0, output: 0, total: 0, turns: 0 })
  const [compactionError, setCompactionError] = createSignal<Error | null>(null)
  const [currentPhase, setCurrentPhase] = createSignal<string>("EXECUTE")
  const [verifyResults, setVerifyResults] = createSignal<Array<{ passed: boolean; message?: string }>>([])

  let toolCallIdCounter = 0
  const toolStartTimes = new Map<string, number>()
  let abortController: AbortController | null = null

  // 输入框操作函数（由 Prompt 组件通过 createEffect 设置）
  let _focusInputFn: (() => void) | null = null
  let _setPromptTextFn: ((text: string) => void) | null = null
  let _prependPromptTextFn: ((text: string) => void) | null = null

  const registerInputFns = (fns: { focus: () => void; setText: (text: string) => void; prependText: (text: string) => void }) => {
    _focusInputFn = fns.focus
    _setPromptTextFn = fns.setText
    _prependPromptTextFn = fns.prependText
  }

  const unregisterInputFns = () => {
    _focusInputFn = null
    _setPromptTextFn = null
    _prependPromptTextFn = null
  }

  const focusInput = () => _focusInputFn?.()
  const setPromptText = (text: string) => _setPromptTextFn?.(text)
  const prependPromptText = (text: string) => _prependPromptTextFn?.(text)

  const abort = () => {
    abortController?.abort()
    inputState.clearQueue()
  }

  // SIGINT 处理
  const originalSigint = process.listeners('SIGINT').slice()
  let sigintHandled = false
  process.removeAllListeners('SIGINT')
  process.on('SIGINT', () => {
    sigintHandled = true
    abort()
    for (const handler of originalSigint) {
      process.on('SIGINT', handler as any)
    }
  })

  // 清理
  onCleanup(() => {
    if (!sigintHandled) {
      process.removeAllListeners('SIGINT')
      for (const handler of originalSigint) {
        process.on('SIGINT', handler as any)
      }
    }
    toolStartTimes.clear()
    streamState.clearStream()
    abortController?.abort()
    abortController = null
    schedulerState.stopLoops()
  })

  let activeModel: any = props.model
  let confirmResolve: ((value: boolean) => void) | null = null
  let persistentSessionId: string | undefined = props.sessionId

  // ===== MCP 初始化 =====
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

          for (const tool of tools) {
            const toolName = `mcp__${id}__${tool.name}`
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

  // ===== Skill 相关 =====
  const setActiveSkill = async (name: string | null) => {
    if (!name) {
      skillState.setActiveSkill(null)
      return
    }
    try {
      const { findSkill, loadAllSkills } = await import("../../skills/loader")
      const skill = await findSkill(name, process.cwd())
      if (skill) {
        skillState.setActiveSkill(name)
      } else {
        const all = await loadAllSkills(process.cwd())
        const available = all.map(s => s.name).join(', ')
        messageState.addMessage({ role: 'system', content: `未找到 skill: ${name}\n可用: ${available || '(无)'}` })
      }
    } catch (e) {
      devLogger.debug("SKILL", "load failed", e)
    }
  }

  const listSkills = async (): Promise<string[]> => {
    return skillState.listSkills()
  }

  // ===== 模型切换 =====
  const switchModel = async (modelId: string) => {
    const cfg = props.llmConfig
    activeModel = await createModel({
      provider: cfg?.provider ?? modelState.currentProvider(),
      model: modelId,
      apiKey: cfg?.apiKey,
      baseUrl: cfg?.baseUrl,
    })
    modelState.switchModel(modelId)
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
    modelState.switchProvider(providerId)
  }

  // ===== Session 恢复 =====
  onMount(() => {
    if (props.sessionId && props.loop) {
      try {
        const modelMsgs = props.loop.getSessionModelMessages(props.sessionId)
        if (modelMsgs.length === 0) return

        const restored: Message[] = []
        let idx = 0
        let toolBatch = 0

        type ContentPart = { type: string; text?: string; toolName?: string; input?: unknown }
        for (const raw of modelMsgs) {
          if (raw.role === 'user' || raw.role === 'assistant') {
            let text = ''
            if (Array.isArray(raw.content)) {
              const parts = raw.content as ContentPart[]
              for (const part of parts) {
                if (part.type === 'text') text += part.text ?? ''
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
              const parts = raw.content as ContentPart[]
              const toolCalls = parts.filter(p => p.type === 'tool-call')
              if (toolCalls.length > 0) toolBatch++
              for (const tc of toolCalls) {
                restored.push({
                  id: `tool_hist_${idx++}`,
                  role: 'tool',
                  content: tc.toolName ?? '',
                  toolName: tc.toolName ?? '',
                  toolArgs: (tc.input ?? {}) as Record<string, unknown>,
                  toolStatus: 'completed' as const,
                  toolBatch,
                  timestamp: Date.now(),
                })
              }
            }
          }
        }

        if (restored.length > 0) {
          messageState.setMessages(restored)
        }
      } catch {
      }
    }
  })

  const clearSession = () => {
    messageState.clearMessages()
    persistentSessionId = undefined
    setLlmCallCount(0)
    setLlmTokenUsage({ input: 0, output: 0, total: 0 })
    skillState.setActiveSkill(null)
    messageState.addMessage({ role: "system", content: "已开新会话" })
  }

  // ===== 核心 run 函数 =====
  const run = async (input: string, opts?: { clipboardImages?: Array<{ base64: string; mimeType: string }> }): Promise<void> => {
    if (confirmResolve) {
      const shouldContinue = input.trim().toLowerCase() === "y"
      const resolve = confirmResolve
      confirmResolve = null
      setIsProcessing(true)
      messageState.addMessage({ role: "system", content: shouldContinue ? "继续执行..." : "停止工具调用" })
      resolve(shouldContinue)
      return
    }

    if (isProcessing()) {
      const msgId = `queued_${++toolCallIdCounter}`
      inputState.enqueue({ text: input })
      messageState.addMessage({ id: msgId, role: "user", content: input, queued: true })
      return
    }

    const { text: cleanText, images: parsedImages } = parseImageRefs(input)
    const allImages = [...parsedImages, ...(opts?.clipboardImages ?? [])]

    const { getSkillIndex } = await import("../../skills/loader")
    const availableSkills = await getSkillIndex(process.cwd())

    // Skill 自动建议
    if (!skillState.activeSkill()) {
      const { matchSkills } = await import("../../skills/auto-suggest")
      const { inferSkillStack } = await import("../../skills/stack")
      const ruleMatched = matchSkills(cleanText, availableSkills, skillState.activeSkill())
      const inferredNames = inferSkillStack(cleanText)
      const inferred = inferredNames
        .map(name => availableSkills.find(s => s.name === name))
        .filter((s): s is SkillIndex => !!s && s.name !== skillState.activeSkill())
      const suggestedMap = new Map<string, SkillIndex>()
      for (const s of [...ruleMatched, ...inferred]) {
        suggestedMap.set(s.name, s)
      }
      const suggested = [...suggestedMap.values()]
      if (suggested.length > 0) {
        skillState.setSkillSuggestIdx(0)
        skillState.setPendingSkillSuggestion(suggested)
        await new Promise<boolean>((resolve) => {
          const timeout = setTimeout(() => resolve(false), 10_000)
          skillState.setSkillSuggestResolve((v) => {
            clearTimeout(timeout)
            resolve(v)
          })
        })
        skillState.setPendingSkillSuggestion(null)
      }
    }

    abortController = new AbortController()
    messageState.addMessage({ role: "user", content: cleanText, images: allImages.length > 0 ? allImages : undefined })
    await new Promise(r => queueMicrotask(r))
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
        activeSkill: skillState.activeSkill() ?? undefined,
        activeSkillInstructions: skillState.activeSkillInstructions() ?? undefined,
        availableSkills,
        onPhaseChange: (phase: string) => {
          setCurrentPhase(phase)
        },
        onPhaseLog: (text: string) => {
          devLogger.info('PHASE', text.trimEnd())
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
          setLlmTokenUsage({
            input: usage.inputTokens,
            output: usage.outputTokens,
            total: usage.inputTokens + usage.outputTokens,
          })
          setCumulativeTokens(prev => ({
            input: prev.input + usage.inputTokens,
            output: prev.output + usage.outputTokens,
            total: prev.total + usage.inputTokens + usage.outputTokens,
            turns: prev.turns + 1,
          }))
        },
        onStreamText: (delta: string) => {
          streamState.onStreamText(delta)
        },
        onIntermediateText: (text: string) => {
          batch(() => {
            streamState.clearStream()
            messageState.addMessage({ role: "assistant", content: text })
          })
        },
        onToolCall: (toolName: string, args: Record<string, unknown>, batchNum: number) => {
          toolCallIdCounter++
          const id = `tool_${toolCallIdCounter}`
          toolStartTimes.set(id, Date.now())
          messageState.addMessage({ id, role: "tool", content: toolName, toolName, toolArgs: args, toolStatus: "running", toolBatch: batchNum })
        },
        onToolResult: (result: any) => {
          const msgs = messageState.messages()
          const lastMsg = msgs[msgs.length - 1]
          if (lastMsg) {
            const start = toolStartTimes.get(lastMsg.id) ?? 0
            const duration = start > 0 ? Date.now() - start : 0
            toolStartTimes.delete(lastMsg.id)
            messageState.updateMessage(lastMsg.id, {
              toolStatus: "completed",
              duration,
              diff: result?.diff
            })
          }
        },
        onSubagentStart: (id: string, task: string) => {
          subagentState.onSubagentStart(id, task)
        },
        onSubagentEnd: (id: string, success: boolean) => {
          subagentState.onSubagentEnd(id, success)
        },
        onConfirmContinue: () => {
          return new Promise<boolean>((resolve) => {
            confirmResolve = resolve
            messageState.addMessage({ role: "system", content: "已达最大迭代次数。输入 y 继续，其他任意键停止。" })
            setIsProcessing(false)
          })
        },
        onCompaction: (summary: string, originalCount: number, preservedCount: number, error?: Error) => {
          if (error) {
            setCompactionError(error)
            toast.show({
              message: `压缩失败: ${error.message.slice(0, 80)}`,
              variant: "error",
              duration: 8000,
            })
            return
          }
          setCompactionError(null)
          if (persistentSessionId) {
            const history = props.loop.getSessionMessages(persistentSessionId)
            messageState.setMessages(history.map((m, i) => ({
              id: `hist_${i}`,
              role: m.role as Message["role"],
              content: m.content,
              timestamp: Date.now() - (history.length - i) * 1000,
            })))
          }
          messageState.addMessage({ role: "system", content: `🗜️ 已压缩对话历史：${originalCount} 条 → 保留 ${preservedCount} 条\n\n${summary}`, compaction: true })
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
        streamState.clearStream()
        messageState.addMessage({
          role: "assistant",
          content: result.text,
          duration: Math.floor((Date.now() - startTime) / 1000),
        })
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      if (!error.includes('abort') && !error.includes('Abort')) {
        messageState.addMessage({ role: "system", content: `错误: ${error}` })
      }
    } finally {
      abortController = null
      setIsProcessing(false)
      clearInterval(timer)
      setElapsed(0)
      streamState.clearStream()
      subagentState.clearSubagents()

      if (inputState.queueLength() > 0) {
        const next = inputState.dequeue()
        if (next) {
          messageState.updateMessage(next.id, { queued: false })
          run(next.text)
        }
      }
    }
  }

  const compactSession = async () => {
    if (!persistentSessionId) {
      messageState.addMessage({ role: "system", content: "没有活跃的 session" })
      return
    }
    messageState.addMessage({ role: "system", content: "正在压缩对话历史..." })
    try {
      const result = await props.loop.compactSession(persistentSessionId)
      if (result) {
        if (result.summary) {
          const tag = result.wasFallback ? '[规则提取]' : '[LLM 摘要]'
          messageState.addMessage({ role: "system", content: `🗜️ 已压缩 ${result.originalCount} 条 → 保留 ${result.preservedCount} 条\n\n${tag}\n${result.summary}`, compaction: true })
        } else {
          messageState.addMessage({ role: "system", content: result.saved > 0 ? `压缩完成，节省 ${result.saved} 条消息` : "无需压缩" })
        }
        if (persistentSessionId) {
          const history = props.loop.getSessionMessages(persistentSessionId)
          messageState.setMessages(history.map((m, i) => ({
            id: `hist_${i}`,
            role: m.role as Message["role"],
            content: m.content,
            timestamp: Date.now() - (history.length - i) * 1000,
          })))
        }
      }
    } catch (e) {
      messageState.addMessage({ role: "system", content: `压缩失败: ${e instanceof Error ? e.message : String(e)}` })
    }
  }

  const contextTokens = createMemo(() => {
    let totalChars = 0
    for (const msg of messageState.messages()) {
      const content = msg.content
      if (Array.isArray(content)) {
        for (const part of content) {
          if (part?.type === 'text' && part?.text) {
            totalChars += part.text.length
          }
        }
      } else if (typeof content === 'string') {
        totalChars += content.length
      }
      if (msg.toolArgs) totalChars += JSON.stringify(msg.toolArgs).length
    }
    return Math.ceil(totalChars / 4)
  })

  // ===== Scheduler =====
  const scheduler = new Scheduler({
    onTrigger: async (prompt: string) => {
      await run(prompt)
    },
    onLog: (msg: string) => {
      messageState.addMessage({ role: "system", content: msg })
    },
  })
  schedulerState.setScheduler(scheduler)

  const addLoop = (interval: string, prompt: string): string | null => {
    const ms = scheduler.parseInterval(interval)
    if (!ms) {
      messageState.addMessage({ role: "system", content: `无效的时间格式: ${interval}。支持: 30s, 5m, 2h, 1d` })
      return null
    }
    const id = scheduler.create(ms, prompt)
    messageState.addMessage({ role: "system", content: `循环已启动 (ID: ${id})\n间隔: ${interval}\nPrompt: ${prompt}\n输入 /loop stop 停止` })
    schedulerState.updateTasks()
    return id
  }

  const stopLoops = () => {
    const count = scheduler.deleteAll()
    messageState.addMessage({ role: "system", content: count > 0 ? `已停止 ${count} 个循环` : "没有运行中的循环" })
    schedulerState.updateTasks()
  }

  const listLoops = () => {
    const tasks = scheduler.list()
    if (tasks.length === 0) {
      messageState.addMessage({ role: "system", content: "没有运行中的循环" })
      return
    }
    const lines = tasks.map(t => {
      const mins = Math.round(t.intervalMs / 60_000)
      return `  ${t.id} | 每 ${mins}m | 已执行 ${t.runCount} 次 | ${t.prompt}`
    })
    messageState.addMessage({ role: "system", content: `运行中的循环 (${tasks.length}):\n${lines.join('\n')}` })
  }

  // ===== 构建 context value =====
  const value: LoopContext = {
    run,
    abort,
    isProcessing,
    pendingCount: inputState.pendingCount,
    elapsed,
    messages: messageState.messages,
    streamingSegments: streamState.streamingSegments,
    pendingText: streamState.pendingText,
    streamMode: streamState.streamMode,
    addMessage: messageState.addMessage,
    updateMessage: messageState.updateMessage,
    clearMessages: messageState.clearMessages,
    clearSession,
    toolCallExpanded,
    toggleToolCallExpanded,
    llmCallCount,
    llmTokenUsage,
    compactSession,
    listSkills,
    currentModel: modelState.currentModel,
    currentProvider: modelState.currentProvider,
    effectiveContextWindow: modelState.effectiveContextWindow,
    compactionError,
    switchModel,
    switchProvider,
    getAvailableModels: modelState.getAvailableModels,
    getAvailableProviders: modelState.getAvailableProviders,
    contextTokens,
    activeSkill: skillState.activeSkill,
    activeSkillInstructions: skillState.activeSkillInstructions,
    setActiveSkill,
    addLoop,
    stopLoops,
    listLoops,
    scheduler,
    currentPhase,
    verifyResults,
    cumulativeTokens,
    subagentStatuses: subagentState.subagentStatuses,
    subagentOpen: subagentState.subagentOpen,
    setSubagentOpen: subagentState.setSubagentOpen,
    focusInput,
    setPromptText,
    prependPromptText,
    registerInputFns,
    unregisterInputFns,
    pendingSkillSuggestion: skillState.pendingSkillSuggestion,
    skillSuggestIdx: skillState.skillSuggestIdx,
    setSkillSuggestIdx: skillState.setSkillSuggestIdx,
    resolveSkillSuggestion: skillState.resolveSuggestion,
  }
  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>
}

export function useLoop(): LoopContext {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useLoop: missing LoopProvider")
  return ctx
}

// 导出 Message 类型供外部使用
export type { Message, AddMessageInput } from "./message"
