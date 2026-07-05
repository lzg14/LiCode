// ============================================================
// v2 智能增强 §4.M5：IntelligenceAdapter 核心类型
// 详细设计: docs/plans/intelligence-enhancement-plan.md §4.M5 + §2.5
//
// 原则（v2 §2.5）：
// 1. adapter 失败不 crash（v2 §4.M5 风险点）— 走 fallback 路径
// 2. 不重建 phase 系统 — 严格 beforeExecute / afterExecute 签名
// 3. 单 adapter 无 DAG（避免 v1 decision tangle，三个 M 同时决策会互相否决）
// ============================================================

import type { ToolStatsEntry, UserPrefEntry, ErrorPatternEntry } from '../../memory/schema'
import type { Memory } from '../../memory/memory'
import type { ExecuteContext } from '../phases/execute/context'

// Re-export 给测试和 decisions 用（避免 import 路径分散）
export type { ToolStatsEntry, UserPrefEntry, ErrorPatternEntry } from '../../memory/schema'

// ===== Inputs (4 类信号) =====

/** M2 项目感知（v2 plan §4.M2，待 M2 落地后由 detect-project 提供） */
export interface ProjectContext {
  type: string
  framework?: string
  testRunner?: string
}

/** M3 代码风格（v2 plan §4.M3，待 M3 落地后由 style 模块提供） */
export interface StyleHints {
  indent: 'tab' | '2-space' | '4-space'
  quote: 'single' | 'double'
  semicolons: boolean
  trailingComma: boolean
}

/** adapter 4 类输入信号（v2 plan §4.M5） */
export interface IntelligenceInputs {
  /** M4 user-pref */
  userPref: UserPrefEntry[]
  /** M4 tool-stats */
  toolStats: ToolStatsEntry[]
  /** M2 项目上下文（占位 — 待 M2 落地） */
  projectContext?: ProjectContext
  /** M3 代码风格（占位 — 待 M3 落地） */
  styleHints?: StyleHints
}

// ===== Outputs =====

/** 单个 decision 的输出（v2 plan §4.M5 "Decisions" 字段） */
export interface DecisionResult {
  /** 决策名（registry 中注册的 key） */
  name: string
  /** 是否触发了实际决策（false → 走 fallback） */
  triggered: boolean
  /** 决策内容（直接注入 system prompt 的文本） */
  content: string
  /** 用于 metrics / 调试的元数据 */
  meta?: Record<string, unknown>
}

/**
 * adapter 输出（v2 plan §4.M5 "Outputs"）
 * - systemHints: 追加到 system prompt 的文本
 * - decisions: 按 name 索引的决策明细
 * - confirmPolicy: 用户确认策略
 * - usedFallback: 是否有 decision 走了 fallback（监控指标用）
 */
export interface AugmentedPrompt {
  systemHints: string
  decisions: Record<string, DecisionResult>
  usedFallback: boolean
  confirmPolicy: 'every-step' | 'milestone' | 'once'
}

// ===== Decision Handler =====

/** 单个 decision handler 的签名 — 纯函数，便于测试 */
export type DecisionHandler = (inputs: IntelligenceInputs) => DecisionResult

// ===== Adapter 上下文 =====

/** IntelligenceAdapter 输入上下文（v2 plan §2.5 beforeExecute/afterExecute 签名） */
export interface IntelligenceContext {
  cwd: string
  sessionId: string
  userInput: string
  modelInfo: { modelId: string; provider: string }
  /** Memory 实例（读取 user-pref / tool-stats，写入新事件） */
  memory: Memory
  /** 可选 execute 上下文（用于在 beforeExecute 中读取 cwd / model 等） */
  executeContext?: ExecuteContext
}

// ===== Recorder 事件 =====

/** Tool 调用结果（recorder 入口 — v2 plan §4.M4 M4 表格） */
export interface ToolCallEvent {
  tool: string
  success: boolean
  durationMs: number
  timeout?: boolean
  /** 用于错误模式检测（M6 占位） */
  errorMessage?: string
}

// ===== Fallback 策略 =====

export interface FallbackPolicy {
  forDecision(name: string): DecisionResult
  confirmPolicy(): AugmentedPrompt['confirmPolicy']
}
