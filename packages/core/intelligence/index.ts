// packages/core/intelligence/ 公开 API
// v2 plan §4.M5 决策整合

export { IntelligenceAdapter, defaultRegistry } from './adapter'
export type { IntelligenceAdapterOptions } from './adapter'
export { DecisionRegistry } from './registry'
export { DefaultFallback, defaultFallback } from './fallback'
export { IntelligenceRecorder } from './recorder'
export type {
  AugmentedPrompt,
  DecisionHandler,
  DecisionResult,
  FallbackPolicy,
  IntelligenceContext,
  IntelligenceInputs,
  ProjectContext,
  StyleHints,
  ToolCallEvent,
} from './types'
export { confirmFrequencyDecision } from './decisions/confirm-frequency'
export { taskDepthDecision } from './decisions/task-depth'
export { toolChoiceDecision } from './decisions/tool-choice'
export { verbosityDecision } from './decisions/verbosity'
