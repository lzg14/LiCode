import { describe, expect, it } from 'vitest'
import { verbosityDecision } from '../../decisions/verbosity'
import type { IntelligenceInputs, UserPrefEntry } from '../../types'

function makePref(signal: string, count: number): UserPrefEntry {
  return {
    id: `user-pref:test:${signal}`,
    scope: 'project',
    type: 'user-pref',
    category: 'comments',
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

describe('verbosityDecision', () => {
  it('no prefs → not triggered', () => {
    const r = verbosityDecision(inputs([]))
    expect(r.triggered).toBe(false)
  })

  it('user_deleted_comment count < 3 → not triggered', () => {
    const r = verbosityDecision(inputs([makePref('user_deleted_comment', 2)]))
    expect(r.triggered).toBe(false)
  })

  it('user_deleted_comment count >= 3 → triggered, no comments hint', () => {
    const r = verbosityDecision(inputs([makePref('user_deleted_comment', 3)]))
    expect(r.triggered).toBe(true)
    expect(r.content).toContain('少注释')
    expect(r.content).toContain('3')
    expect(r.meta?.noCommentsCount).toBe(3)
  })

  it('user_added_type count >= 2 → triggered, more types hint', () => {
    const r = verbosityDecision(inputs([makePref('user_added_type', 2)]))
    expect(r.triggered).toBe(true)
    expect(r.content).toContain('类型')
    expect(r.content).toContain('显式声明类型')
  })

  it('user_added_type count < 2 → not triggered', () => {
    const r = verbosityDecision(inputs([makePref('user_added_type', 1)]))
    expect(r.triggered).toBe(false)
  })

  it('both prefs trigger → content merged', () => {
    const r = verbosityDecision(inputs([
      makePref('user_deleted_comment', 4),
      makePref('user_added_type', 3),
    ]))
    expect(r.triggered).toBe(true)
    expect(r.content).toContain('少注释')
    expect(r.content).toContain('类型')
  })
})
