import type { Phase, Config } from './types'
import type { LLMProvider } from '../llm/types'
import { observe } from './phases/observe'
import { think } from './phases/think'
import { plan } from './phases/plan'
import { build } from './phases/build'
import { execute } from './phases/execute'
import { verify } from './phases/verify'
import { learn } from './phases/learn'
import { Memory } from '../memory/memory'
import { auditLogger } from '../audit/logger'
import { GitIntegration } from '../integration/git'
import { pluginManager } from '../integration/plugin'
import { CheckpointManager, type SessionCheckpoint } from './checkpoint'
import { Projector } from './projector'
import { ContextCompactor } from './compaction'


export interface LoopContext {
  sessionId: string
  userInput: string
  effortLevel: number
  phase: Phase
  cwd: string
  llm?: LLMProvider
  memory?: Memory
  // 回调函数
  onPhaseChange?: (phase: Phase) => void
  onStreamText?: (text: string) => void
  onToolCall?: (toolName: string) => void
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
}

const PHASE_ORDER: Phase[] = ['OBSERVE', 'THINK', 'PLAN', 'BUILD', 'EXECUTE', 'VERIFY', 'LEARN']

// E1 快速路径：跳过 THINK/PLAN/BUILD
const FAST_PATH: Phase[] = ['OBSERVE', 'EXECUTE', 'VERIFY']

export class CoreLoop {
  private memory: Memory
  private git?: GitIntegration
  private checkpointManager: CheckpointManager
  private projector: Projector
  private compactor: ContextCompactor

  constructor(private config: Config, private llm?: LLMProvider) {
    this.memory = new Memory(config.cwd)
    this.checkpointManager = new CheckpointManager(config.cwd)
    this.projector = new Projector()
    this.compactor = new ContextCompactor()

    // 初始化 Git 集成
    if (config.cwd) {
      this.git = new GitIntegration(config.cwd)
      this.git.connect().catch(() => {})
    }
  }

  async run(ctx: LoopContext): Promise<string> {
    const startTime = Date.now()

    // 如果外部没有传入 llm，使用构造时注入的
    const effectiveLlm = ctx.llm ?? this.llm
    ctx = { ...ctx, llm: effectiveLlm, memory: this.memory }

    // 尝试恢复最近的 checkpoint
    const restoredCheckpoint = await this.checkpointManager.restore(ctx.sessionId)
    if (restoredCheckpoint) {
      ctx.checkpoint = restoredCheckpoint
      ctx = { ...ctx, ...restoredCheckpoint.context }
    }

    // 触发 session:start hook
    try {
      await pluginManager.emit('session:start', ctx.sessionId)
    } catch {
      // plugin hook 失败不应阻断主流程
    }

    // 记录会话开始
    auditLogger.logSessionStart(ctx.sessionId)

    try {
      // 先执行 OBSERVE 判断 Effort Level
      ctx.onPhaseChange?.('OBSERVE')
      const observeResult = await observe(ctx)
      ctx = { ...ctx, ...observeResult }

      // 根据 Effort Level 选择路径
      const phases = ctx.effortLevel === 1 ? FAST_PATH : PHASE_ORDER
      const startIndex = 1 // 从 THINK 开始

      for (let i = startIndex; i < phases.length; i++) {
        const phase = phases[i]
        
        // 在每个阶段开始前创建 checkpoint
        if (phase === 'EXECUTE' || phase === 'VERIFY') {
          await this.checkpointManager.save(ctx.sessionId, {
            phase,
            context: { phase, effortLevel: ctx.effortLevel },
            timestamp: Date.now(),
          })
        }
        
        const result = await this.executePhase(phase, ctx)
        ctx = { ...ctx, ...result }
        
        // 检查是否需要压缩上下文
        if (ctx.streamBuffer && ctx.streamBuffer.length > 10000) {
          ctx = await this.compactContext(ctx)
        }
      }

      // 存储记忆
      if (ctx.aiResponse) {
        try {
          await this.memory.store({
            scope: 'session',
            type: 'memory',
            content: `User: ${ctx.userInput}\nAI: ${ctx.aiResponse}`,
          })
        } catch {
          // 记忆存储失败不应阻断主流程
        }
      }
    } finally {
      // 记录会话结束
      const duration = Date.now() - startTime
      auditLogger.logSessionEnd(ctx.sessionId, duration)

      // 触发 session:end hook
      try {
        await pluginManager.emit('session:end', ctx.sessionId)
      } catch {
        // plugin hook 失败不应阻断主流程
      }
    }

    // 投影最终输出
    const projected = this.projector.project(ctx)
    ctx.projectedOutput = projected

    // 返回 AI 回复，如果没有则返回用户输入
    return projected || (ctx.aiResponse ?? ctx.userInput)
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

  private async executePhase(phase: Phase, ctx: LoopContext): Promise<Partial<LoopContext>> {
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
      case 'EXECUTE':
        return execute(ctx)
      case 'VERIFY':
        return verify(ctx)
      case 'LEARN':
        return learn(ctx)
      default:
        throw new Error(`Unknown phase: ${phase}`)
    }
  }

  /**
   * 调用 LLM 生成回复（支持流式输出）
   */
  async callLLM(ctx: LoopContext, systemPrompt: string): Promise<string> {
    if (!ctx.llm) {
      return '请配置 LLM provider'
    }

    try {
      // 检查是否支持流式输出
      if ('stream' in ctx.llm) {
        const stream = (ctx.llm as any).stream({
          model: this.config.llm.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: ctx.userInput },
          ],
          temperature: 0.7,
        })

        let fullContent = ''
        for await (const chunk of stream) {
          const text = chunk.content || ''
          if (text) {
            fullContent += text
            ctx.onStreamText?.(text)
            // 缓冲流式输出
            ctx.streamBuffer = (ctx.streamBuffer || '') + text
          }
        }
        return fullContent
      }

      // 回退到非流式调用
      const response = await ctx.llm.complete({
        model: this.config.llm.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: ctx.userInput },
        ],
        temperature: 0.7,
      })
      
      // 一次性输出全部内容
      ctx.onStreamText?.(response.content)
      ctx.streamBuffer = response.content
      
      return response.content
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      ctx.onStreamText?.(`[LLM Error] ${error}\n`)
      return `抱歉，AI 调用失败: ${error}`
    }
  }

  /**
   * 流式调用 LLM 并逐块处理
   */
  async callLLMStream(
    ctx: LoopContext,
    systemPrompt: string,
    onChunk: (chunk: string) => void
  ): Promise<string> {
    if (!ctx.llm) {
      return '请配置 LLM provider'
    }

    try {
      if ('stream' in ctx.llm) {
        const stream = (ctx.llm as any).stream({
          model: this.config.llm.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: ctx.userInput },
          ],
          temperature: 0.7,
        })

        let fullContent = ''
        for await (const chunk of stream) {
          const text = chunk.content || ''
          if (text) {
            fullContent += text
            onChunk(text)
            ctx.onStreamText?.(text)
            ctx.streamBuffer = (ctx.streamBuffer || '') + text
          }
        }
        return fullContent
      }

      // 回退到非流式调用
      const response = await ctx.llm.complete({
        model: this.config.llm.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: ctx.userInput },
        ],
        temperature: 0.7,
      })
      
      onChunk(response.content)
      ctx.onStreamText?.(response.content)
      ctx.streamBuffer = response.content
      
      return response.content
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      const errorText = `[LLM Error] ${error}\n`
      onChunk(errorText)
      ctx.onStreamText?.(errorText)
      return errorText
    }
  }
}
