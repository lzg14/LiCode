import { describe, expect, it } from 'vitest'
import { confirmFrequencyDecision } from '../../decisions/confirm-frequency'
import type { IntelligenceInputs, UserPrefEntry } from '../../types'

function makePref(signal: string, count: number, category: UserPrefEntry['category'] = 'workflow'): UserPrefEntry {
  return {
    id: `user-pref:test:${signal}`,
    scope: 'project',
    type: 'user-pref',
    category,
    signal,
    count,
    confidence: Math.min(0.9, 0.1 + count * 0.2),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    accessCount: count,
  }
}

function inputs(userPref: UserPrefEntry[]): IntelligenceInputs {
  return { userPref, toolStats: [] }
}

describe('confirmFrequencyDecision', () => {
  it('no prefs → not triggered', () => {
    const r = confirmFrequencyDecision(inputs([]))
    expect(r.triggered).toBe(false)
  })

  it('user_chose_confirm_all count < 2 → not triggered', () => {
    const r = confirmFrequencyDecision(inputs([makePref('user_chose_confirm_all', 1)]))
    expect(r.triggered).toBe(false)
  })

  it('user_chose_confirm_all count >= 2 → triggered, "确认到底" hint', () => {
    const r = confirmFrequencyDecision(inputs([makePref('user_chose_confirm_all', 2)]))
    expect(r.triggered).toBe(true)
    expect(r.content).toContain('确认到底')
    expect(r.meta?.confirmAllCount).toBe(2)
  })

  it('user_rejected_continue count >= 3 → triggered, "高频确认" hint', () => {
    const r = confirmFrequencyDecision(inputs([makePref('user_rejected_continue', 3)]))
    expect(r.triggered).toBe(true)
    expect(r.content).toContain('高频确认')
    expect(r.meta?.rejectContinueCount).toBe(3)
  })

  it('user_rejected_continue count < 3 → not triggered', () => {
    const r = confirmFrequencyDecision(inputs([makePref('user_rejected_continue', 2)]))
    expect(r.triggered).toBe(false)
  })

  it('both prefs trigger → rejectContinue takes priority (higher severity)', () => {
    // 当两个都触发时，rejectContinue 先判断（更严格）
    const r = confirmFrequencyDecision(inputs([
      makePref('user_chose_confirm_all', 5),
      makePref('user_rejected_continue', 5),
    ]))
    expect(r.triggered).toBe(true)
    expect(r.content).toContain('高频确认') // 优先级：高频 > 一次到底
  })
})
