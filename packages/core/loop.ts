import type { Phase, Config } from './types'
import type { LLMProvider } from '../llm/types'
import { createModel } from '../llm/provider'
import { execute } from './phases/execute'
import { devLogger } from './dev-logger'
import { homedir } from 'os'
import { join } from 'path'
import { Memory } from '../memory/memory'
import { SessionManager } from '../session/session'
import { GitIntegration } from '../integration/git'
import { pluginManager } from '../integration/plugin'
import { CheckpointManager, type SessionCheckpoint } from './checkpoint'
import { Projector } from './projector'
import { ContextCompactor } from './compaction'
import { SessionCompactor } from './session-compactor'
import { Timer, type PerfTrace } from './perf'


export interface LoopContext {
  sessionId: string
  userInput: string
  effortLevel: number
  phase: Phase
  cwd: string
  llm?: LLMProvider
  model?: any
  memory?: Memory
  // 回调函数
  onPhaseChange?: (phase: Phase) => void
  onPhaseLog?: (text: string) => void
  onStreamText?: (text: string) => void
  signal?: AbortSignal
  onLLMCall?: () => void
  onLLMResult?: (usage: { inputTokens: number; outputTokens: number; totalTokens: number }) => void
  onToolCall?: (toolName: string, args: Record<string, unknown>, batch: number) => void
  onToolResult?: (result: unknown) => void
  onIntermediateText?: (text: string) => void
  onConfirmContinue?: () => Promise<boolean>
  onCompaction?: (summary: string, originalCount: number, preservedCount: number) => void
  // 流式输出缓冲
  streamBuffer?: string
  // Phase-specific fields
  sensitiveWarning?: string
  risks?: string[]
  pendingQuestions?: string[]
  antiCriteria?: string[]
  plan?: { steps: string[] }
  pendingReview?: { status: string; issues: string[] }
  reviewResult?: { approved: boolean; issues: string[]; status: string }
  intermediateResults?: unknown[]
  deliverable?: unknown[]
  // AI 回复
  aiResponse?: string
  // Checkpoint 相关
  checkpoint?: SessionCheckpoint
  // 投影器输出
  projectedOutput?: string
  // 性能埋点（每次对话结束时回调）
  onPerfTrace?: (trace: PerfTrace) => void
  // 历史压缩摘要（由 SessionCompactor 注入）
  sessionSummary?: string
  // Skill 相关
  activeSkill?: string
  activeSkillInstructions?: string
}

export class CoreLoop {
  private memory: Memory
  private sessionManager: SessionManager
  private git?: GitIntegration
  private checkpointManager: CheckpointManager
  private projector: Projector
  private compactor: ContextCompactor
  private sessionCompactor: SessionCompactor

  constructor(private config: Config, private llm?: LLMProvider) {
    this.memory = new Memory(config.cwd)
    const home = homedir()
    const memoryPath = (config.memory?.path ?? './licode-sessions.db').replace(/^~/, home)
    this.sessionManager = new SessionManager(memoryPath)
    this.checkpointManager = new CheckpointManager(config.cwd)
    this.projector = new Projector()
    this.compactor = new ContextCompactor()
    this.sessionCompactor = new SessionCompactor({ dataDir: join(homedir(), '.licode') })

    // 初始化 Git 集成
    if (config.cwd) {
      this.git = new GitIntegration(config.cwd)
      this.git.connect().catch((e) => { devLogger.debug('GIT', 'connect failed', e) })
    }
  }

  /**
   * 获取最近一次会话的 ID（按 updated_at 降序）。
   * 如果 directory 为空，取全局最近的一条；否则取指定目录下最近的一条。
   */
  getLastSessionId(directory?: string): string | null {
    return this.sessionManager.getLastSession(directory)?.id ?? null
  }

  getSessionMessages(sessionId: string): Array<{ role: string; content: string }> {
    return this.sessionManager.getMessagesAsModelMessages(sessionId).map(m => {
      let text = ''
      if (Array.isArray(m.content)) {
        for (const part of m.content) {
          if (part.type === 'text') text += part.text
        }
      } else if (typeof m.content === 'string') {
        text = m.content
      }
      return { role: m.role, content: text }
    }).filter(m => m.content.trim())
  }

  /**
   * 搜索 session 历史消息（关键词匹配，返回带轮次序号的摘要）
   */
  searchSessionMessages(sessionId: string, query: string, limit = 8): Array<{ turn: number; role: string; snippet: string }> {
    if (!query.trim()) return []
    const messages = this.getSessionMessages(sessionId)
    const q = query.toLowerCase()
    const results: Array<{ turn: number; role: string; snippet: string }> = []
    let turn = 0
    for (const m of messages) {
      if (m.role === 'user') turn++
      const lower = m.content.toLowerCase()
      const idx = lower.indexOf(q)
      if (idx >= 0) {
        const start = Math.max(0, idx - 30)
        const end = Math.min(m.content.length, idx + query.length + 30)
        const snippet = (start > 0 ? '…' : '') + m.content.slice(start, end) + (end < m.content.length ? '…' : '')
        results.push({ turn, role: m.role, snippet })
        if (results.length >= limit) break
      }
    }
    return results
  }

  /**
   * 手动触发 session 压缩（供 /compact 命令调用）
   */
  async compactSession(sessionId: string): Promise<{ summary: string; saved: number; originalCount: number; preservedCount: number; wasFallback?: boolean } | null> {
    const session = this.sessionManager.getSession(sessionId)
    if (!session) return null

    const history = this.sessionManager.getMessagesAsModelMessages(sessionId)
    if (!this.sessionCompactor.shouldCompact(history, sessionId)) {
      return { summary: '消息数未达压缩阈值，无需压缩', saved: 0, originalCount: 0, preservedCount: 0 }
    }

    const llmProvider = this.llm
    const result = await this.sessionCompactor.compact(history, sessionId, llmProvider)
    return {
      summary: result.summary,
      saved: result.originalCount - result.preservedCount,
      originalCount: result.originalCount,
      preservedCount: result.preservedCount,
      wasFallback: result.wasFallback,
    }
  }

  async run(ctx: LoopContext): Promise<{ text: string; sessionId: string }> {
    const startTime = Date.now()
    const timer = new Timer(0)

    // 如果外部没有传入 llm，使用构造时注入的
    const effectiveLlm = ctx.llm ?? this.llm
    const model = ctx.model ?? (this.llm ? await createModel({ provider: this.config.llm.provider, model: this.config.llm.model, apiKey: this.config.llm.apiKey, baseUrl: this.config.llm.baseUrl }) : undefined)
    ctx = { ...ctx, llm: effectiveLlm, model, memory: this.memory }

    // 复用已有 session（跨轮对话），或创建新 session
    let session = ctx.sessionId ? this.sessionManager.getSession(ctx.sessionId) : null
    if (!session) {
      session = this.sessionManager.createSession({
        directory: ctx.cwd,
        model: this.config.llm.model,
        provider: this.config.llm.provider,
      })
      ctx.sessionId = session.id
    }

    // 记录用户消息
    this.sessionManager.addMessage({
      sessionId: session.id,
      role: 'user',
      content: ctx.userInput,
    })

    // 尝试恢复最近的 checkpoint
    const restoredCheckpoint = await this.checkpointManager.restore(ctx.sessionId)
    if (restoredCheckpoint) {
      ctx.checkpoint = restoredCheckpoint
      ctx = { ...ctx, ...restoredCheckpoint.context }
    }

    // 触发 session:start hook
    try {
      await pluginManager.emit('session:start', ctx.sessionId)
    } catch (e) {
      devLogger.debug('PLUGIN', 'session:start hook failed', e)
    }

    try {
      // 直接执行，让 LLM 自己决定用什么工具、做什么
      ctx.onPhaseChange?.('EXECUTE')
      const executeId = timer.start('phase.EXECUTE')

      // 创建 checkpoint
      await this.checkpointManager.save(ctx.sessionId, {
        phase: 'EXECUTE',
        context: { phase: 'EXECUTE', effortLevel: ctx.effortLevel },
        timestamp: Date.now(),
      })

      let result: Partial<LoopContext>
      let lastError: Error | null = null
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          result = await this.executePhase('EXECUTE', ctx, timer)
          break
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err))
          devLogger.debug('LOOP', `Execute attempt ${attempt + 1} failed`, lastError)
          if (attempt < 2) {
            await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
          }
        }
      }
      timer.end(executeId)

      if (lastError) {
        return { text: `LLM 调用失败（已重试 3 次）: ${lastError.message}`, sessionId: ctx.sessionId }
      }
      ctx = { ...ctx, ...result! }

      // 检查是否需要压缩上下文
      if (ctx.streamBuffer && ctx.streamBuffer.length > 10000) {
        const compactId = timer.start('phase.compact')
        ctx = await this.compactContext(ctx)
        timer.end(compactId)
      }

      // 记录 AI 回复
      if (ctx.aiResponse) {
        const saveId = timer.start('save.assistant')
        this.sessionManager.addMessage({
          sessionId: session.id,
          role: 'assistant',
          content: ctx.aiResponse,
          model: this.config.llm.model,
        })
        timer.end(saveId)
      }

      // 存储记忆
      if (ctx.aiResponse) {
        const memId = timer.start('memory.store')
        try {
          await this.memory.store({
            scope: 'session',
            type: 'memory',
            content: `User: ${ctx.userInput}\nAI: ${ctx.aiResponse}`,
          })
        } catch (e) {
          devLogger.debug('MEMORY', 'memory store failed', e)
        }
        timer.end(memId)
      }
    } finally {
      // 更新 session 状态
      this.sessionManager.updateSession(session.id, { status: 'completed' })

      // 记录会话结束
      const duration = Date.now() - startTime

      // 构建并回调 perf trace
      const trace = timer.buildTrace(ctx.sessionId)
      try {
        ctx.onPerfTrace?.(trace)
      } catch (e) {
        devLogger.debug('PERF', 'onPerfTrace callback failed', e)
      }

      // 触发 session:end hook
      try {
        await pluginManager.emit('session:end', ctx.sessionId)
      } catch (e) {
        devLogger.debug('PLUGIN', 'session:end hook failed', e)
      }
    }

    // 投影最终输出
    const projected = this.projector.project(ctx)
    ctx.projectedOutput = projected

    // 返回 AI 回复，如果没有则返回用户输入
    return { text: projected || (ctx.aiResponse ?? ctx.userInput), sessionId: ctx.sessionId }
  }

  private async compactContext(ctx: LoopContext): Promise<LoopContext> {
    const messages = ctx.streamBuffer ? [{ content: ctx.streamBuffer }] : []
    const result = await this.compactor.compact(messages, 4000)
    
    // 清空缓冲并保存压缩后的摘要
    ctx.streamBuffer = ''
    if (result.summary) {
      ctx.streamBuffer = result.summary
    }
    
    return ctx
  }

  private async executePhase(phase: Phase, ctx: LoopContext, timer: Timer): Promise<Partial<LoopContext>> {
    // 通知阶段变化
    ctx.onPhaseChange?.(phase)

    // 加载 session 历史消息
    const historyStartId = timer.start('history.load')
    const history = this.sessionManager.getMessagesAsModelMessages(ctx.sessionId)
    timer.end(historyStartId, { count: history.length })

    // 检查是否需要压缩历史
    if (this.sessionCompactor.shouldCompact(history, ctx.sessionId)) {
      devLogger.debug('COMPACT', `History ${history.length} messages, triggering compaction`)
      const hasExisting = this.sessionCompactor.hasSummary(ctx.sessionId)
      if (!hasExisting) {
        const result = await this.sessionCompactor.compact(history, ctx.sessionId, this.llm)
        ctx.sessionSummary = result.summary
        ctx.onCompaction?.(result.summary, result.originalCount, result.preservedCount)
      } else {
        ctx.sessionSummary = this.sessionCompactor.loadLatestSummary(ctx.sessionId) ?? undefined
        this.sessionCompactor.compact(history, ctx.sessionId, this.llm).then((result) => {
          ctx.onCompaction?.(result.summary, result.originalCount, result.preservedCount)
        }).catch((e) => {
          devLogger.debug('COMPACT', 'Background compaction failed', e)
        })
      }
    } else {
      if (!ctx.sessionSummary && this.sessionCompactor.hasSummary(ctx.sessionId)) {
        ctx.sessionSummary = this.sessionCompactor.loadLatestSummary(ctx.sessionId) ?? undefined
      }
    }

    // 直接执行，让 LLM 自己决定用什么工具、做什么
    const aiResponse = await execute({
      model: ctx.model,
      userInput: ctx.userInput,
      history,
      sessionSummary: ctx.sessionSummary,
      sessionId: ctx.sessionId,
      sessionManager: this.sessionManager,
      cwd: ctx.cwd,
      activeSkill: ctx.activeSkill,
      activeSkillInstructions: ctx.activeSkillInstructions,
      onStreamText: ctx.onStreamText,
      onLLMCall: ctx.onLLMCall,
      onLLMResult: ctx.onLLMResult,
      onToolCall: ctx.onToolCall,
      onToolResult: ctx.onToolResult,
      onIntermediateText: ctx.onIntermediateText,
      onConfirmContinue: ctx.onConfirmContinue,
      signal: ctx.signal,
      timer,
    })

    return { aiResponse, deliverable: ctx.intermediateResults }
  }

}
