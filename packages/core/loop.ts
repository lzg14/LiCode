import type { Phase, Config } from './types'
import type { LLMProvider } from '../llm/types'
import { createModel } from '../llm/provider'
import { observe } from './phases/observe'
import { think } from './phases/think'
import { plan } from './phases/plan'
import { build } from './phases/build'
import { execute } from './phases/execute'
import { verify } from './phases/verify'
import { learn } from './phases/learn'
import { devLogger } from './dev-logger'
import { Memory } from '../memory/memory'
import { SessionManager } from '../session/session'
import { auditLogger } from '../audit/logger'
import { GitIntegration } from '../integration/git'
import { pluginManager } from '../integration/plugin'
import { CheckpointManager, type SessionCheckpoint } from './checkpoint'
import { Projector } from './projector'
import { ContextCompactor } from './compaction'
import { SessionCompactor } from './session-compactor'
import { join } from 'path'
import { homedir } from 'os'
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
  onToolCall?: (toolName: string, args: Record<string, unknown>) => void
  onToolResult?: (result: unknown) => void
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
}

const PHASE_ORDER: Phase[] = ['OBSERVE', 'THINK', 'PLAN', 'BUILD', 'EXECUTE', 'VERIFY', 'LEARN']

// E1 快速路径：跳过 THINK/PLAN/BUILD
const FAST_PATH: Phase[] = ['OBSERVE', 'EXECUTE', 'VERIFY']

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
    this.sessionManager = new SessionManager(
      config.memory?.path?.replace(/\.\w+$/, '.sessions.db') ?? './licode-sessions.db'
    )
    this.checkpointManager = new CheckpointManager(config.cwd)
    this.projector = new Projector()
    this.compactor = new ContextCompactor()
    this.sessionCompactor = new SessionCompactor({ dataDir: join(homedir(), '.licode') })

    // 初始化 Git 集成
    if (config.cwd) {
      this.git = new GitIntegration(config.cwd)
      this.git.connect().catch(() => {})
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
   * 手动触发 session 压缩（供 /compact 命令调用）
   */
  async compactSession(sessionId: string): Promise<{ summary: string; saved: number } | null> {
    const session = this.sessionManager.getSession(sessionId)
    if (!session) return null

    const history = this.sessionManager.getMessagesAsModelMessages(sessionId)
    if (!this.sessionCompactor.shouldCompact(history, sessionId)) {
      return { summary: '消息数未达压缩阈值，无需压缩', saved: 0 }
    }

    const llmProvider = this.llm
    const result = await this.sessionCompactor.compact(history, sessionId, llmProvider)
    return {
      summary: result.summary,
      saved: result.originalCount - result.preservedCount,
    }
  }

  async run(ctx: LoopContext): Promise<{ text: string; sessionId: string }> {
    const startTime = Date.now()
    const timer = new Timer(0)

    // 如果外部没有传入 llm，使用构造时注入的
    const effectiveLlm = ctx.llm ?? this.llm
    const model = ctx.model ?? (this.llm ? createModel({ provider: this.config.llm.provider, model: this.config.llm.model, apiKey: this.config.llm.apiKey, baseUrl: this.config.llm.baseUrl }) : undefined)
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
    auditLogger.logSessionStart(ctx.sessionId)

    try {
      // 先执行 OBSERVE 判断 Effort Level
      timer.checkpoint('phase.OBSERVE.start')
      ctx.onPhaseChange?.('OBSERVE')
      const observeResult = await observe(ctx)
      ctx = { ...ctx, ...observeResult }
      timer.checkpoint('phase.OBSERVE.end')

      // 根据 Effort Level 选择路径
      const phases = ctx.effortLevel === 1 ? FAST_PATH : PHASE_ORDER
      const startIndex = 1 // 从 THINK 开始

      for (let i = startIndex; i < phases.length; i++) {
        const phase = phases[i]
        const phaseStartId = timer.start(`phase.${phase}`, { effortLevel: ctx.effortLevel })

        // 在每个阶段开始前创建 checkpoint
        if (phase === 'EXECUTE' || phase === 'VERIFY') {
          await this.checkpointManager.save(ctx.sessionId, {
            phase,
            context: { phase, effortLevel: ctx.effortLevel },
            timestamp: Date.now(),
          })
        }

        const result = await this.executePhase(phase, ctx, timer)
        ctx = { ...ctx, ...result }
        timer.end(phaseStartId)

        // 检查是否需要压缩上下文
        if (ctx.streamBuffer && ctx.streamBuffer.length > 10000) {
          const compactId = timer.start('phase.compact')
          ctx = await this.compactContext(ctx)
          timer.end(compactId)
        }
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
      auditLogger.logSessionEnd(ctx.sessionId, duration)

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

    switch (phase) {
      case 'OBSERVE':
        return observe(ctx)
      case 'THINK':
        return think(ctx)
      case 'PLAN':
        return plan(ctx)
      case 'BUILD':
        return build(ctx)
      case 'EXECUTE': {
        // 加载 session 历史消息
        const historyStartId = timer.start('history.load')
        const history = this.sessionManager.getMessagesAsModelMessages(ctx.sessionId)
        timer.end(historyStartId, { count: history.length })

        // 检查是否需要压缩历史
        // 同步部分立即执行（规则提取），异步部分（LLM 精炼）走子 agent 不阻塞
        if (this.sessionCompactor.shouldCompact(history, ctx.sessionId)) {
          devLogger.debug('COMPACT', `History ${history.length} messages, triggering compaction agent`)
          // 先加载已有摘要（如果有）
          ctx.sessionSummary = this.sessionCompactor.loadLatestSummary(ctx.sessionId) ?? undefined
          // 异步触发压缩，走子 agent（便宜模型），不阻塞主流程
          this.sessionCompactor.compact(history, ctx.sessionId, this.llm).catch((e) => {
            devLogger.debug('COMPACT', 'Background compaction failed', e)
          })
        } else {
          // 即使不需要压缩，也尝试加载已有摘要（跨启动恢复时）
          if (!ctx.sessionSummary && this.sessionCompactor.hasSummary(ctx.sessionId)) {
            ctx.sessionSummary = this.sessionCompactor.loadLatestSummary(ctx.sessionId) ?? undefined
          }
        }

        const aiResponse = await execute({
          model: ctx.model,
          userInput: ctx.userInput,
          history,
          sessionSummary: ctx.sessionSummary,
          sessionId: ctx.sessionId,
          sessionManager: this.sessionManager,
          cwd: ctx.cwd,
          onStreamText: ctx.onStreamText,
          onLLMCall: ctx.onLLMCall,
          onLLMResult: ctx.onLLMResult,
          onToolCall: ctx.onToolCall,
          onToolResult: ctx.onToolResult,
          signal: ctx.signal,
          timer,
        })
        return { phase: 'VERIFY', aiResponse, deliverable: ctx.intermediateResults }
      }
      case 'VERIFY':
        return verify(ctx)
      case 'LEARN':
        return learn(ctx)
      default:
        throw new Error(`Unknown phase: ${phase}`)
    }
  }

}
