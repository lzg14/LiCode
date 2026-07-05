import { describe, expect, it } from 'vitest'
import { toolChoiceDecision } from '../../decisions/tool-choice'
import type { IntelligenceInputs, ToolStatsEntry } from '../../types'

function makeStats(tool: string, success: number, failure: number, timeout = 0, avg = 100): ToolStatsEntry {
  return {
    id: `tool-stats:test:${tool}`,
    scope: 'project',
    type: 'tool-stats',
    tool,
    successCount: success,
    failureCount: failure,
    timeoutCount: timeout,
    avgDurationMs: avg,
    lastUsedAt: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    accessCount: success + failure,
  }
}

function inputs(toolStats: ToolStatsEntry[]): IntelligenceInputs {
  return { userPref: [], toolStats }
}

describe('toolChoiceDecision', () => {
  it('no stats → not triggered', () => {
    const r = toolChoiceDecision(inputs([]))
    expect(r.triggered).toBe(false)
    expect(r.content).toBe('')
  })

  it('low sample (< 5) → not triggered even with failures', () => {
    const stats = [makeStats('edit', 2, 2)] // 50% failure rate but only 4 samples
    const r = toolChoiceDecision(inputs(stats))
    expect(r.triggered).toBe(false)
  })

  it('edit failure rate > 30% with >= 5 samples → triggered', () => {
    const stats = [makeStats('edit', 5, 5)] // 50% failure rate, 10 samples
    const r = toolChoiceDecision(inputs(stats))
    expect(r.triggered).toBe(true)
    expect(r.content).toContain('edit')
    expect(r.content).toContain('50%')
    expect(r.content).toContain('read')
    expect(r.content).toContain('write')
    expect(r.meta?.editFailureRate).toBeCloseTo(0.5)
  })

  it('edit failure rate exactly 30% → not triggered (strict >)', () => {
    const stats = [makeStats('edit', 7, 3)] // 30% — boundary, should not trigger
    const r = toolChoiceDecision(inputs(stats))
    expect(r.triggered).toBe(false)
  })

  it('bash timeout > 3 → triggered', () => {
    const stats = [makeStats('bash', 10, 0, 4)]
    const r = toolChoiceDecision(inputs(stats))
    expect(r.triggered).toBe(true)
    expect(r.content).toContain('bash')
    expect(r.content).toContain('4 次')
    expect(r.content).toContain('拆分')
    expect(r.meta?.bashTimeoutCount).toBe(4)
  })

  it('bash timeout exactly 3 → not triggered (strict >)', () => {
    const stats = [makeStats('bash', 10, 0, 3)]
    const r = toolChoiceDecision(inputs(stats))
    expect(r.triggered).toBe(false)
  })

  it('edit + bash both trigger → content merged', () => {
    const stats = [
      makeStats('edit', 5, 5),
      makeStats('bash', 10, 0, 5),
    ]
    const r = toolChoiceDecision(inputs(stats))
    expect(r.triggered).toBe(true)
    expect(r.content).toContain('edit')
    expect(r.content).toContain('bash')
  })
})
