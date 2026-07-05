import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { CompareResult, RunResult } from './types'

/**
 * 生成 markdown 报告 + JSON 结果
 *
 * 输出位置：{outputDir}/reports/{date}.{md,json}
 */
export function generateReport(results: RunResult[], outputDir = './eval-results'): string {
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true })
  const reportsDir = join(outputDir, 'reports')
  if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true })

  const date = new Date().toISOString().slice(0, 10)
  const mdPath = join(reportsDir, `${date}.md`)
  const jsonPath = join(reportsDir, `${date}.json`)

  const total = results.length
  const passed = results.filter(r => r.success).length
  const completionRate = total > 0 ? passed / total : 0
  const avgTurns = total > 0 ? results.reduce((s, r) => s + r.turns, 0) / total : 0
  const avgLatency = total > 0 ? results.reduce((s, r) => s + r.latencyMs, 0) / total : 0
  const totalTokens = results.reduce((s, r) => s + r.tokenCost, 0)

  const md = `# Eval Report ${date}

## 摘要

- 总数：${total} 个 scenario
- 通过：${passed} (${(completionRate * 100).toFixed(1)}%)
- 平均 turn：${avgTurns.toFixed(2)}
- 平均 latency：${avgLatency.toFixed(0)}ms
- 总 token：${totalTokens}

## 详细

| Scenario | Success | Turns | Latency | Tokens | Errors |
|----------|---------|-------|---------|--------|--------|
${results
  .map(
    r =>
      `| ${r.scenarioId} | ${r.success ? '✅' : '❌'} | ${r.turns} | ${r.latencyMs}ms | ${r.tokenCost} | ${r.errors.length > 0 ? r.errors[0] : '-'} |`,
  )
  .join('\n')}
`

  writeFileSync(mdPath, md, 'utf-8')
  writeFileSync(
    jsonPath,
    JSON.stringify({ date, total, passed, completionRate, avgTurns, avgLatency, totalTokens, results }, null, 2),
    'utf-8',
  )
  return mdPath
}

/** A/B 对比：生成报告 */
export function generateCompareReport(compare: CompareResult, outputDir = './eval-results'): string {
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true })
  const reportsDir = join(outputDir, 'reports')
  if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true })

  const date = new Date().toISOString().slice(0, 10)
  const mdPath = join(reportsDir, `${date}-compare.md`)

  const improvements = compare.perScenario.filter(p => p.improvement === 'better').length
  const regressions = compare.perScenario.filter(p => p.improvement === 'regression').length

  const md = `# A/B Compare Report ${date}

## 总体 delta

| 指标 | Delta | 说明 |
|------|-------|------|
| Completion Rate | ${(compare.deltas.completionRate * 100).toFixed(1)}% | 正=变好 |
| Avg Turns | ${compare.deltas.avgTurns.toFixed(2)} | 负=更好（少 turn）|
| p95 Latency | ${compare.deltas.p95Latency.toFixed(0)}ms | 负=更快 |
| Token Cost | ${compare.deltas.tokenCost} | 负=更省 |

## 改进 vs 退化

- 改进：${improvements} 个 scenario
- 退化：${regressions} 个 scenario

## 详细 per-scenario

| Scenario | Baseline | Treatment | Improvement |
|----------|----------|-----------|-------------|
${compare.perScenario
  .map(
    p =>
      `| ${p.scenarioId} | ${p.baselineSuccess ? '✅' : '❌'} | ${p.treatmentSuccess ? '✅' : '❌'} | ${p.improvement} |`,
  )
  .join('\n')}
`

  writeFileSync(mdPath, md, 'utf-8')
  return mdPath
}
