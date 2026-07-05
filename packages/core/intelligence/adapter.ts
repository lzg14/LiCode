// IntelligenceAdapter — M5 主类
// v2 plan §4.M5: 单 adapter，无 DAG
// v2 plan §2.5: 严格 beforeExecute / afterExecute 签名
//
// 关键不变式：
// 1. adapter 失败不 crash（v2 §4.M5 风险点）— 走 fallback 路径
// 2. 每个 decision 独立 catch — 单个失败不污染其他
// 3. systemHints 永远是 plain text（LLM 直接吃）

import { devLogger } from '../dev-logger'
import { confirmFrequencyDecision } from './decisions/confirm-frequency'
import { taskDepthDecision } from './decisions/task-depth'
import { toolChoiceDecision } from './decisions/tool-choice'
import { verbosityDecision } from './decisions/verbosity'
import { defaultFallback, type FallbackPolicy } from './fallback'
import { IntelligenceRecorder } from './recorder'
import { DecisionRegistry } from './registry'
import type {
  AugmentedPrompt,
  DecisionResult,
  IntelligenceContext,
  IntelligenceInputs,
  ToolCallEvent,
} from './types'

export interface IntelligenceAdapterOptions {
  registry?: DecisionRegistry
  recorder?: IntelligenceRecorder
  fallback?: FallbackPolicy
}

export class IntelligenceAdapter {
  private registry: DecisionRegistry
  private recorder: IntelligenceRecorder
  private fallback: FallbackPolicy

  constructor(opts: IntelligenceAdapterOptions = {}) {
    this.registry = opts.registry ?? defaultRegistry()
    this.recorder = opts.recorder ?? new IntelligenceRecorder()
    this.fallback = opts.fallback ?? defaultFallback()
  }

  /**
   * 收集 4 类输入信号（v2 plan §4.M5 "Inputs"）
   * M2/M3 占位（v2 plan §4.M5 风险点：M2/M3 待开发）
   */
  private async collectInputs(ictx: IntelligenceContext): Promise<IntelligenceInputs> {
    const allEntries = ictx.memory.list('project')
    const userPref = allEntries.filter(
      (e): e is Extract<typeof e, { type: 'user-pref' }> => e.type === 'user-pref',
    )
    const toolStats = allEntries.filter(
      (e): e is Extract<typeof e, { type: 'tool-stats' }> => e.type === 'tool-stats',
    )
    return {
      userPref,
      toolStats,
      // M2 / M3 待开发，目前不传
      projectContext: undefined,
      styleHints: undefined,
    }
  }

  /**
   * 把每个 decision 的 content 合并成 systemHints
   * 顺序按 registry.list()（插入顺序）
   * 格式：每个 decision 一段 `## {name}\n{content}`，空 content 跳过
   */
  private composeSystemHints(decisions: Record<string, DecisionResult>): string {
    const sections: string[] = []
    for (const name of this.registry.list()) {
      const d = decisions[name]
      if (d?.triggered && d.content) {
        sections.push(d.content)
      }
    }
    if (sections.length === 0) return ''
    return `## IntelligenceAdapter Hints\n\n${sections.join('\n\n')}\n`
  }

  /**
   * 从 decisions 中提取 confirmPolicy（confirm-frequency 决策驱动）
   */
  private computeConfirmPolicy(decisions: Record<string, DecisionResult>): AugmentedPrompt['confirmPolicy'] {
    const cf = decisions['confirm-frequency']
    if (!cf?.triggered) return this.fallback.confirmPolicy()
    // confirm-frequency 决策的 content 包含 'every-step' 或 '确认到底' 关键字
    // 简化：基于 content 判断
    if (cf.content.includes('高频确认')) return 'every-step'
    if (cf.content.includes('确认到底')) return 'once'
    return this.fallback.confirmPolicy()
  }

  /**
   * v2 plan §2.5: beforeExecute(ctx) → AugmentedPrompt
   * 严格隔离：每个 decision 独立 try/catch
   */
  async beforeExecute(ictx: IntelligenceContext): Promise<AugmentedPrompt> {
    try {
      const inputs = await this.collectInputs(ictx)
      const decisions: Record<string, DecisionResult> = {}
      let usedFallback = false

      for (const name of this.registry.list()) {
        const handler = this.registry.get(name)
        if (!handler) continue
        try {
          decisions[name] = handler(inputs)
          if (!decisions[name].triggered) usedFallback = true
        } catch (e) {
          // 单个 decision 失败 → fallback（v2 §4.M5 风险点）
          devLogger.warn('INTEL', `decision ${name} failed: ${e}`)
          decisions[name] = this.fallback.forDecision(name)
          usedFallback = true
        }
      }

      const confirmPolicy = this.computeConfirmPolicy(decisions)
      const systemHints = this.composeSystemHints(decisions)
      return { systemHints, decisions, usedFallback, confirmPolicy }
    } catch (e) {
      // 整体失败 → 走原 LLM 行为（空 hints + default confirmPolicy）
      devLogger.warn('INTEL', `beforeExecute failed: ${e}`)
      return {
        systemHints: '',
        decisions: {},
        usedFallback: true,
        confirmPolicy: this.fallback.confirmPolicy(),
      }
    }
  }

  /**
   * v2 plan §2.5: afterExecute(ctx, result) → 写 Memory (recorder)
   * 严格隔离：每个 tool call 独立处理，失败不 throw
   */
  async afterExecute(ictx: IntelligenceContext, events: ToolCallEvent[]): Promise<void> {
    for (const event of events) {
      await this.recorder.recordToolCall(ictx, event)
    }
  }

  // ---- 内部访问器（测试用） ----

  getRegistry(): DecisionRegistry {
    return this.registry
  }

  getRecorder(): IntelligenceRecorder {
    return this.recorder
  }

  getFallback(): FallbackPolicy {
    return this.fallback
  }
}

/** 默认注册了 4 个 decision 的 registry 工厂 */
export function defaultRegistry(): DecisionRegistry {
  const r = new DecisionRegistry()
  r.register('tool-choice', toolChoiceDecision)
  r.register('verbosity', verbosityDecision)
  r.register('confirm-frequency', confirmFrequencyDecision)
  r.register('task-depth', taskDepthDecision)
  return r
}
