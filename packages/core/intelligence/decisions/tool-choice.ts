// tool-choice decision: 基于 M4 tool-stats 推荐工具选择
// v2 plan §4.M4 表格:
//   - edit 工具找不到 oldString → tool-stats miss_count++ → 超过 2 次 → 改用 read+write
//   - bash 工具执行超时 → tool-stats timeout_count++ → 超过 3 次 → 推荐拆分命令
//
// 规则（v2 风险点优化）：
//   - 样本量 < 5 不决策（避免冷启动误报）
//   - edit 失败率 > 30% → 推荐 read + write
//   - bash timeout > 3 次 → 推荐拆分
//   - 同时触发 → 输出合并提示

import type { DecisionHandler } from '../types'

const MIN_SAMPLES = 5
const EDIT_FAILURE_RATE_THRESHOLD = 0.3
const BASH_TIMEOUT_THRESHOLD = 3

export const toolChoiceDecision: DecisionHandler = (inputs) => {
  const editStats = inputs.toolStats.find((s) => s.tool === 'edit')
  const bashStats = inputs.toolStats.find((s) => s.tool === 'bash')

  const hints: string[] = []
  const meta: Record<string, unknown> = {}

  // edit 失败率高
  if (editStats) {
    const total = editStats.successCount + editStats.failureCount
    if (total >= MIN_SAMPLES) {
      const failureRate = editStats.failureCount / total
      if (failureRate > EDIT_FAILURE_RATE_THRESHOLD) {
        hints.push(
          `- **edit 工具历史失败率较高**（${(failureRate * 100).toFixed(0)}%，${editStats.failureCount}/${total}）。`
          + `建议优先使用 \`read\` + \`write\` 组合（更可靠），避免依赖模糊匹配的 edit。`,
        )
        meta.editFailureRate = failureRate
        meta.editSamples = total
      }
    }
  }

  // bash 超时多
  if (bashStats && bashStats.timeoutCount > BASH_TIMEOUT_THRESHOLD) {
    hints.push(
      `- **bash 工具超时 ${bashStats.timeoutCount} 次**。建议拆分长命令为多个小命令，`
      + `或用更具体的工具（read/write 替代 cat/grep/awk）。`,
    )
    meta.bashTimeoutCount = bashStats.timeoutCount
  }

  if (hints.length === 0) {
    return { name: 'tool-choice', triggered: false, content: '' }
  }

  return {
    name: 'tool-choice',
    triggered: true,
    content: `## 工具选择提示\n\n${hints.join('\n')}`,
    meta,
  }
}
