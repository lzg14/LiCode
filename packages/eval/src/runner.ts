import type { RunOptions, RunResult, Scenario } from './types'

/**
 * 跑一组 scenarios
 *
 * 当前实现是 mock：返回占位 RunResult。
 * 完整集成（实际跑 licode agent）在 v0.4.5 Phase 3 做。
 */
export async function runScenarios(scenarios: Scenario[], options: RunOptions = {}): Promise<RunResult[]> {
  const results: RunResult[] = []
  for (const scenario of scenarios) {
    if (scenario.setup) await scenario.setup()
    try {
      const result = await runOne(scenario, options)
      results.push(result)
    } finally {
      if (scenario.teardown) await scenario.teardown()
    }
  }
  return results
}

async function runOne(scenario: Scenario, options: RunOptions): Promise<RunResult> {
  const start = Date.now()
  // Mock 模式：返回占位 result
  if (options.mock !== false) {
    return {
      scenarioId: scenario.id,
      success: true,
      turns: scenario.expect.turns?.max ? Math.floor(scenario.expect.turns.max / 2) : 1,
      toolCalls: scenario.expect.toolCalls ?? [],
      latencyMs: Date.now() - start,
      tokenCost: 0,
      errors: [],
      trace: '[mock] no actual run, integrate with licode agent in v0.4.5',
    }
  }
  // 真跑模式（v0.4.5 实施）
  return {
    scenarioId: scenario.id,
    success: false,
    turns: 0,
    toolCalls: [],
    latencyMs: 0,
    tokenCost: 0,
    errors: ['Real run not yet implemented (v0.4.5 Phase 3)'],
    trace: 'todo: integrate with execute()',
  }
}
