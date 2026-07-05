import { describe, expect, it } from 'vitest'
import { taskDepthDecision } from '../../decisions/task-depth'
import type { IntelligenceInputs } from '../../types'

describe('taskDepthDecision', () => {
  it('always not triggered (M2 placeholder)', () => {
    const r = taskDepthDecision({ userPref: [], toolStats: [] } as IntelligenceInputs)
    expect(r.triggered).toBe(false)
    expect(r.content).toBe('')
    expect(r.meta?.placeholder).toBe(true)
    expect(r.meta?.m2Required).toBe(true)
  })
})
