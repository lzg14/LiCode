import { describe, expect, it } from 'vitest'
import {
  type ErrorPatternEntry,
  type MemoryEntry,
  type ToolStatsEntry,
  type UserPrefEntry,
  recordErrorPattern,
  recordUserPref,
  updateToolStats,
} from '../schema'

describe('schema v2 (M4/M6 extension)', () => {
  describe('backward compatibility', () => {
    it('legacy MemoryEntry still works', () => {
      const entry: MemoryEntry = {
        id: 'legacy-1',
        scope: 'global',
        type: 'memory',
        content: 'old entry',
        createdAt: 1000,
        updatedAt: 1000,
        accessCount: 0,
      }
      expect(entry.type).toBe('memory')
      expect(entry.content).toBe('old entry')
    })
  })

  describe('ToolStatsEntry', () => {
    it('should create initial entry from first call', () => {
      const entry = updateToolStats(undefined, 'edit', { success: true, durationMs: 100 })
      const _t: ToolStatsEntry = entry
      expect(entry.tool).toBe('edit')
      expect(entry.successCount).toBe(1)
      expect(entry.failureCount).toBe(0)
      expect(entry.avgDurationMs).toBe(100)
    })

    it('should accumulate counts and weighted avg duration', () => {
      const a = updateToolStats(undefined, 'bash', { success: true, durationMs: 100 })
      const b = updateToolStats(a, 'bash', { success: true, durationMs: 200 })
      const c = updateToolStats(b, 'bash', { success: false, durationMs: 50, timeout: true })
      expect(c.successCount).toBe(2)
      expect(c.failureCount).toBe(1)
      expect(c.timeoutCount).toBe(1)
      expect(c.avgDurationMs).toBeCloseTo(116.67, 1) // (100+200+50)/3
      expect(c.accessCount).toBe(3)
    })
  })

  describe('UserPrefEntry', () => {
    it('should create initial entry', () => {
      const entry = recordUserPref(undefined, 'user_deleted_comment', 'comments')
      const _t: UserPrefEntry = entry
      expect(entry.category).toBe('comments')
      expect(entry.count).toBe(1)
      expect(entry.confidence).toBe(0.3) // 0.1 + 1*0.2
    })

    it('should cap confidence at 0.9', () => {
      let entry: UserPrefEntry | undefined
      for (let i = 0; i < 10; i++) entry = recordUserPref(entry, 'sig', 'types')
      expect(entry?.count).toBe(10)
      expect(entry?.confidence).toBe(0.9) // capped
    })
  })

  describe('ErrorPatternEntry', () => {
    it('should create initial entry', () => {
      const entry = recordErrorPattern(undefined, "Module not found: 'foo'", false)
      const _t: ErrorPatternEntry = entry
      expect(entry.pattern).toBe("Module not found: 'foo'")
      expect(entry.hitCount).toBe(1)
      expect(entry.confidence).toBe(0.1)
    })

    it('should reach 0.8 confidence after 5+ hits with >80% auto-fix success', () => {
      let entry: ErrorPatternEntry | undefined
      // 5 hits, 5 success
      for (let i = 0; i < 5; i++) entry = recordErrorPattern(entry, 'pattern', true)
      expect(entry?.hitCount).toBe(5)
      expect(entry?.successFixCount).toBe(5)
      expect(entry?.confidence).toBe(0.8)
    })

    it('should stay low confidence if auto-fix success rate is low', () => {
      let entry: ErrorPatternEntry | undefined
      // 10 hits, only 1 success → 10% success rate
      for (let i = 0; i < 9; i++) entry = recordErrorPattern(entry, 'p', false)
      entry = recordErrorPattern(entry, 'p', true)
      expect(entry?.confidence).toBe(0.1)
    })
  })

  describe('discriminated union', () => {
    it('should allow AnyMemoryEntry in array', () => {
      const entries: (MemoryEntry | ToolStatsEntry | UserPrefEntry | ErrorPatternEntry)[] = [
        {
          id: '1',
          scope: 'global',
          type: 'memory',
          content: 'x',
          createdAt: 0,
          updatedAt: 0,
          accessCount: 0,
        },
        updateToolStats(undefined, 'edit', { success: true, durationMs: 10 }),
        recordUserPref(undefined, 'sig', 'types'),
        recordErrorPattern(undefined, 'p', false),
      ]
      expect(entries).toHaveLength(4)
      // type 区分
      const types = entries.map(e => e.type)
      expect(types).toContain('memory')
      expect(types).toContain('tool-stats')
      expect(types).toContain('user-pref')
      expect(types).toContain('error-pattern')
    })
  })
})
