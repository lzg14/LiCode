/**
 * Eval 框架入口（v2 智能增强 §7）
 *
 * 详细设计: docs/plans/intelligence-enhancement-plan.md §7
 * 实施状态：v0.4.1 spike — 仅 mock 实现，v0.4.5 Phase 3 完整集成。
 */

import { runScenarios } from './src/runner'
import { generateCompareReport, generateReport } from './src/report'
import { SCENARIOS } from './src/scenarios.bench'
import type { CompareResult, RunOptions, RunResult, Scenario } from './src/types'

export type { CompareResult, RunOptions, RunResult, Scenario }
export { SCENARIOS, generateCompareReport, generateReport, runScenarios }

/** 列出所有 scenario（CLI: licode eval list）*/
export function listScenarios(): Scenario[] {
  return SCENARIOS
}

/** 跑 eval（CLI: licode eval run）*/
export async function runEval(opts: { config?: string; output?: string } = {}): Promise<RunResult[]> {
  const results = await runScenarios(SCENARIOS, { mock: true, outputDir: opts.output })
  generateReport(results, opts.output)
  return results
}

/** A/B 对比（CLI: licode eval compare）*/
export async function compareEval(baseline: string, treatment: string, outputDir = './eval-results'): Promise<CompareResult> {
  // 占位：v0.4.5 Phase 3 实施
  // 读取 baseline/treatment 的 JSON 结果，对比
  const { readFileSync, existsSync } = await import('node:fs')
  if (!existsSync(baseline)) throw new Error(`Baseline not found: ${baseline}`)
  if (!existsSync(treatment)) throw new Error(`Treatment not found: ${treatment}`)

  const b: { results: RunResult[] } = JSON.parse(readFileSync(baseline, 'utf-8'))
  const t: { results: RunResult[] } = JSON.parse(readFileSync(treatment, 'utf-8'))

  const baseSuccesses = b.results.map(r => r.success)
  const treatSuccesses = t.results.map(r => r.success)
  const baseRate = baseSuccesses.filter(Boolean).length / baseSuccesses.length
  const treatRate = treatSuccesses.filter(Boolean).length / treatSuccesses.length
  const baseAvgTurns = b.results.reduce((s, r) => s + r.turns, 0) / b.results.length
  const treatAvgTurns = t.results.reduce((s, r) => s + r.turns, 0) / t.results.length

  const perScenario = b.results.map((br, i) => {
    const tr = t.results[i]
    let improvement: 'better' | 'same' | 'worse' | 'regression' = 'same'
    if (!br.success && tr?.success) improvement = 'better'
    else if (br.success && !tr?.success) improvement = 'regression'
    else if ((tr?.turns ?? 0) < br.turns) improvement = 'better'
    else if ((tr?.turns ?? 0) > br.turns) improvement = 'worse'
    return {
      scenarioId: br.scenarioId,
      baselineSuccess: br.success,
      treatmentSuccess: tr?.success ?? false,
      improvement,
    }
  })

  const result: CompareResult = {
    baseline: b.results,
    treatment: t.results,
    deltas: {
      completionRate: treatRate - baseRate,
      avgTurns: treatAvgTurns - baseAvgTurns,
      p95Latency: 0, // 简化
      tokenCost: 0,
    },
    perScenario,
  }
  generateCompareReport(result, outputDir)
  return result
}

// CLI 入口
if (import.meta.main) {
  const args = process.argv.slice(2)
  const command = args[0]
  if (command === 'list') {
    console.log(`Found ${listScenarios().length} scenarios:`)
    for (const s of listScenarios()) console.log(`  [${s.tier}] ${s.id} (M=${s.module ?? '-'})`)
  } else if (command === 'run') {
    const output = args.includes('--output') ? args[args.indexOf('--output') + 1] : './eval-results'
    console.log(`Running ${SCENARIOS.length} scenarios (mock)...`)
    const results = await runEval({ output })
    const passed = results.filter(r => r.success).length
    console.log(`✓ ${passed}/${results.length} passed`)
    console.log(`Report: ${output}/reports/${new Date().toISOString().slice(0, 10)}.md`)
  } else if (command === 'compare') {
    const baseline = args[1]
    const treatment = args[2]
    if (!baseline || !treatment) {
      console.error('Usage: compare <baseline.json> <treatment.json>')
      process.exit(1)
    }
    const result = await compareEval(baseline, treatment)
    console.log(`Completion delta: ${(result.deltas.completionRate * 100).toFixed(1)}%`)
    console.log(`Avg turns delta: ${result.deltas.avgTurns.toFixed(2)}`)
  } else {
    console.log('Usage:')
    console.log('  bun run packages/eval/index.ts list')
    console.log('  bun run packages/eval/index.ts run [--output DIR]')
    console.log('  bun run packages/eval/index.ts compare <baseline.json> <treatment.json>')
  }
}
