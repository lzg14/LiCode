/**
 * 评估框架类型定义（v2 智能增强 §7）
 *
 * 详细设计: docs/plans/intelligence-enhancement-plan.md §7
 */

/** 单个评估场景 */
export interface Scenario {
  id: string
  prompt: string
  /** 跑前准备（创建临时文件、git commit 等）*/
  setup?: () => Promise<void>
  /** 跑后清理 */
  teardown?: () => Promise<void>
  /** 期望行为 */
  expect: {
    toolCalls?: string[] // 期望工具序列（顺序不一定严格）
    turns?: { max: number; min?: number } // 期望 turn 数范围
    /** 成功判据 */
    successCriteria: 'file_changed' | 'test_passes' | 'lint_clean' | 'manual'
  }
  tier: 'easy' | 'medium' | 'hard'
  /** 关联到的 M 维度（用于 A/B 对比时分组）*/
  module?: string
}

/** 单次跑的结果 */
export interface RunResult {
  scenarioId: string
  success: boolean
  turns: number
  toolCalls: string[]
  latencyMs: number
  tokenCost: number
  errors: string[]
  /** 实际跑了什么（详细）*/
  trace?: string
}

/** A/B 对比结果 */
export interface CompareResult {
  baseline: RunResult[]
  treatment: RunResult[]
  deltas: {
    completionRate: number // treatment.completion - baseline.completion
    avgTurns: number // treatment.avg - baseline.avg
    p95Latency: number
    tokenCost: number
  }
  /** 每个 scenario 的对比 */
  perScenario: Array<{
    scenarioId: string
    baselineSuccess: boolean
    treatmentSuccess: boolean
    improvement: 'better' | 'same' | 'worse' | 'regression'
  }>
  /** markdown 报告 */
  reportPath?: string
}

/** 跑场景的选项 */
export interface RunOptions {
  /** 启用的 M 列表（空 = baseline；full = 所有 M）*/
  intelligenceConfig?: {
    hardware?: boolean
    project?: boolean
    style?: boolean
    memory?: boolean
    adapter?: boolean
    errorPatterns?: boolean
    temporal?: boolean
  }
  /** 输出目录（默认 ./eval-results）*/
  outputDir?: string
  /** 是否 mock（不真跑 LLM，纯走 scenario 流程）*/
  mock?: boolean
}
