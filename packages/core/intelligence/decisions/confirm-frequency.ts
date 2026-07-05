// confirm-frequency decision: 基于 M4 user-pref 控制确认频率
// v2 plan §4.M5 "Decisions" 字段：
//   - 确认频率（每步确认 vs 一次确认到底）
//
// 信号：
//   - 'user_chose_confirm_all' count >= 2 → 'once'（一次确认到底）
//   - 'user_rejected_continue' count >= 3 → 'every-step'（每步确认）
//
// 输出 confirmPolicy 字段，影响 TUI 是否每次显示 continue 提示。

import type { DecisionHandler } from '../types'

const CONFIRM_ALL_THRESHOLD = 2
const REJECT_CONTINUE_THRESHOLD = 3

export interface ConfirmFrequencyResult {
  policy: 'every-step' | 'milestone' | 'once'
  triggered: boolean
  content: string
  meta: Record<string, unknown>
}

export const confirmFrequencyDecision: DecisionHandler = (inputs) => {
  const confirmAll = inputs.userPref.find((p) => p.signal === 'user_chose_confirm_all')
  const rejectContinue = inputs.userPref.find((p) => p.signal === 'user_rejected_continue')

  const meta: Record<string, unknown> = {}

  if (rejectContinue && rejectContinue.count >= REJECT_CONTINUE_THRESHOLD) {
    meta.rejectContinueCount = rejectContinue.count
    return {
      name: 'confirm-frequency',
      triggered: true,
      content: `## 确认策略提示\n\n用户偏好：高频确认（已 ${rejectContinue.count} 次拒绝继续）。每个有副作用的操作（删除文件、修改状态）前显式确认。`,
      meta,
    }
  }

  if (confirmAll && confirmAll.count >= CONFIRM_ALL_THRESHOLD) {
    meta.confirmAllCount = confirmAll.count
    return {
      name: 'confirm-frequency',
      triggered: true,
      content: `## 确认策略提示\n\n用户偏好：减少中途确认（已选择 "确认到底" ${confirmAll.count} 次）。除非有高风险操作（删除文件、push 远程、覆盖配置），否则直接执行到底。`,
      meta,
    }
  }

  return { name: 'confirm-frequency', triggered: false, content: '', meta: {} }
}
