import type { Scenario } from './types'

/**
 * 5-10 个示例 scenarios（v2 §7.2）
 *
 * 完整 50-100 个标准化 task set 在 v0.4.5 Phase 3 完善。
 * 当前是占位 + 真实场景示例。
 */
export const SCENARIOS: Scenario[] = [
  {
    id: 'fix-ts-error',
    prompt: 'packages/cli/logs.ts:42 有 TS error TS2345, 修复',
    expect: {
      toolCalls: ['read', 'edit'],
      turns: { max: 5 },
      successCriteria: 'lint_clean',
    },
    tier: 'easy',
    module: 'M1',
  },
  {
    id: 'add-feature-session-cap',
    prompt: '给 SessionCompactor 加 hard cap 1000',
    expect: {
      toolCalls: ['read', 'grep', 'edit', 'bash'],
      turns: { max: 10 },
      successCriteria: 'test_passes',
    },
    tier: 'medium',
    module: 'M1',
  },
  {
    id: 'refactor-style',
    prompt: '把 packages/core/execute.ts 重命名 executePhases 为 execute',
    expect: {
      toolCalls: ['grep', 'read', 'edit', 'grep', 'bash'],
      turns: { max: 8 },
      successCriteria: 'lint_clean',
    },
    tier: 'medium',
    module: 'M3',
  },
  {
    id: 'add-error-pattern',
    prompt: 'Module not found 错误时自动搜索相似文件名',
    expect: {
      toolCalls: ['read', 'grep', 'edit', 'bash'],
      turns: { max: 12 },
      successCriteria: 'test_passes',
    },
    tier: 'hard',
    module: 'M6',
  },
  {
    id: 'create-doc',
    prompt: '为 Memory 类写 JSDoc 注释',
    expect: {
      toolCalls: ['read', 'edit'],
      turns: { max: 6 },
      successCriteria: 'manual',
    },
    tier: 'easy',
    module: 'M4',
  },
]
