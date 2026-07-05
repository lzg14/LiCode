// Fallback 策略（v2 plan §4.M5 风险点："决策错误时如何 fallback"）
//
// 原则：
// 1. 每个 decision 失败 → 返回 triggered=false 的占位 DecisionResult
// 2. confirmPolicy 默认 'once'（让用户主导）
// 3. systemHints 默认为空（不污染 LLM 行为）

import type { AugmentedPrompt, DecisionResult } from './types'

export interface FallbackPolicy {
  forDecision(name: string): DecisionResult
  confirmPolicy(): AugmentedPrompt['confirmPolicy']
}

export class DefaultFallback implements FallbackPolicy {
  forDecision(name: string): DecisionResult {
    return {
      name,
      triggered: false,
      content: '',
      meta: { fallback: 'default' },
    }
  }

  confirmPolicy(): AugmentedPrompt['confirmPolicy'] {
    return 'once'
  }
}

export function defaultFallback(): FallbackPolicy {
  return new DefaultFallback()
}
