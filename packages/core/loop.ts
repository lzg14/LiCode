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
}

const PHASE_ORDER: Phase[] = ['OBSERVE', 'THINK', 'PLAN', 'BUILD', 'EXECUTE', 'VERIFY', 'LEARN']

// E1 快速路径：跳过 THINK/PLAN/BUILD
const FAST_PATH: Phase[] = ['OBSERVE', 'EXECUTE', 'VERIFY']

export class CoreLoop {
  private memory: Memory

  constructor(private config: Config, private llm?: LLMProvider) {
    this.memory = new Memory(config.cwd)
  }

  async run(ctx: LoopContext): Promise<string> {
    const startTime = Date.now()

    // 如果外部没有传入 llm，使用构造时注入的
    const effectiveLlm = ctx.llm ?? this.llm
    ctx = { ...ctx, llm: effectiveLlm, memory: this.memory }

    // 记录会话开始
    auditLogger.logSessionStart(ctx.sessionId)

    // 先执行 OBSERVE 判断 Effort Level
    ctx.onPhaseChange?.('OBSERVE')
    const observeResult = await observe(ctx)
    ctx = { ...ctx, ...observeResult }

    // 根据 Effort Level 选择路径
    const phases = ctx.effortLevel === 1 ? FAST_PATH : PHASE_ORDER
    const startIndex = 1 // 从 THINK 开始

    for (let i = startIndex; i < phases.length; i++) {
      const phase = phases[i]
      const result = await this.executePhase(phase, ctx)
      ctx = { ...ctx, ...result }
    }

    // 存储记忆
    if (ctx.aiResponse) {
      await this.memory.store({
        scope: 'session',
        type: 'memory',
        content: `User: ${ctx.userInput}\nAI: ${ctx.aiResponse}`,
      })
    }

    // 记录会话结束
    const duration = Date.now() - startTime
    auditLogger.logSessionEnd(ctx.sessionId, 1)

    // 返回 AI 回复，如果没有则返回用户输入
    return ctx.aiResponse ?? ctx.userInput
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
   * 调用 LLM 生成回复
   */
  async callLLM(ctx: LoopContext, systemPrompt: string): Promise<string> {
    if (!ctx.llm) {
      return '请配置 LLM provider'
    }

    try {
      const response = await ctx.llm.complete({
        model: this.config.llm.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: ctx.userInput },
        ],
        temperature: 0.7,
      })
      return response.content
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      ctx.onStreamText?.(`[LLM Error] ${error}\n`)
      return `抱歉，AI 调用失败: ${error}`
    }
  }
}
