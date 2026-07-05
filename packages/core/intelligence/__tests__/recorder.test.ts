import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Memory } from '../../../memory/memory'
import { IntelligenceRecorder } from '../recorder'
import type { IntelligenceContext } from '../types'

describe('IntelligenceRecorder', () => {
  let tmpDir: string
  let memory: Memory
  let ictx: IntelligenceContext

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'intel-test-'))
    memory = new Memory(tmpDir, { maxAgeMs: 365 * 24 * 60 * 60 * 1000 })
    ictx = {
      cwd: tmpDir,
      sessionId: 'sess-1',
      userInput: 'hello',
      modelInfo: { modelId: 'test-model', provider: 'test' },
      memory,
    }
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('recordToolCall', () => {
    it('first call → creates tool-stats entry with id, count=1', async () => {
      const r = new IntelligenceRecorder()
      await r.recordToolCall(ictx, { tool: 'edit', success: true, durationMs: 100 })

      const entries = memory.list('project')
      const stats = entries.find((e) => e.type === 'tool-stats')
      expect(stats).toBeTruthy()
      if (stats && stats.type === 'tool-stats') {
        expect(stats.tool).toBe('edit')
        expect(stats.successCount).toBe(1)
        expect(stats.failureCount).toBe(0)
        expect(stats.avgDurationMs).toBe(100)
        expect(stats.id).toContain('tool-stats-')
      }
    })

    it('multiple calls → upserts (same id, accumulated counts)', async () => {
      const r = new IntelligenceRecorder()
      await r.recordToolCall(ictx, { tool: 'edit', success: true, durationMs: 100 })
      await r.recordToolCall(ictx, { tool: 'edit', success: true, durationMs: 200 })
      await r.recordToolCall(ictx, { tool: 'edit', success: false, durationMs: 50 })

      const stats = memory.list('project').find((e) => e.type === 'tool-stats')
      if (stats && stats.type === 'tool-stats') {
        expect(stats.successCount).toBe(2)
        expect(stats.failureCount).toBe(1)
        // avg = (100 + 200 + 50) / 3 = 116.67
        expect(stats.avgDurationMs).toBeCloseTo(116.67, 1)
      } else {
        expect.fail('tool-stats not found')
      }
    })

    it('different tools → separate entries', async () => {
      const r = new IntelligenceRecorder()
      await r.recordToolCall(ictx, { tool: 'edit', success: true, durationMs: 100 })
      await r.recordToolCall(ictx, { tool: 'bash', success: false, durationMs: 200, timeout: true })

      const stats = memory.list('project').filter((e) => e.type === 'tool-stats')
      expect(stats.length).toBe(2)
      const bashStats = stats.find((s) => s.type === 'tool-stats' && s.tool === 'bash')
      expect(bashStats && bashStats.type === 'tool-stats' && bashStats.timeoutCount).toBe(1)
    })

    it('does not throw on write failure (devLogger.warn only)', async () => {
      const r = new IntelligenceRecorder()
      // 注入一个坏的 ictx：memory.list() throw
      const badMemory = {
        list: () => { throw new Error('mock failure') },
        writeRaw: async () => { throw new Error('write failed') },
      } as unknown as Memory
      const badIctx: IntelligenceContext = { ...ictx, memory: badMemory }
      await expect(r.recordToolCall(badIctx, { tool: 'edit', success: true, durationMs: 100 })).resolves.toBeUndefined()
    })
  })

  describe('recordUserPref', () => {
    it('creates user-pref entry with count=1', async () => {
      const r = new IntelligenceRecorder()
      await r.recordUserPref(ictx, 'user_deleted_comment', 'comments')

      const pref = memory.list('project').find((e) => e.type === 'user-pref')
      expect(pref).toBeTruthy()
      if (pref && pref.type === 'user-pref') {
        expect(pref.signal).toBe('user_deleted_comment')
        expect(pref.category).toBe('comments')
        expect(pref.count).toBe(1)
        expect(pref.confidence).toBeCloseTo(0.3, 2)
      }
    })

    it('multiple records → accumulates count and confidence', async () => {
      const r = new IntelligenceRecorder()
      await r.recordUserPref(ictx, 'user_deleted_comment', 'comments')
      await r.recordUserPref(ictx, 'user_deleted_comment', 'comments')
      await r.recordUserPref(ictx, 'user_deleted_comment', 'comments')

      const pref = memory.list('project').find((e) => e.type === 'user-pref')
      if (pref && pref.type === 'user-pref') {
        expect(pref.count).toBe(3)
        // confidence = min(0.9, 0.1 + 3 * 0.2) = 0.7
        expect(pref.confidence).toBeCloseTo(0.7, 2)
      }
    })
  })

  describe('recordErrorPattern', () => {
    it('first hit → creates error-pattern with hitCount=1, low confidence', async () => {
      const r = new IntelligenceRecorder()
      await r.recordErrorPattern(ictx, 'Module not found: .*', false)

      const ep = memory.list('project').find((e) => e.type === 'error-pattern')
      expect(ep).toBeTruthy()
      if (ep && ep.type === 'error-pattern') {
        expect(ep.pattern).toBe('Module not found: .*')
        expect(ep.hitCount).toBe(1)
        expect(ep.confidence).toBeCloseTo(0.1, 2)
      }
    })

    it('>5 hits with >80% success → confidence jumps to 0.8', async () => {
      const r = new IntelligenceRecorder()
      for (let i = 0; i < 5; i++) {
        await r.recordErrorPattern(ictx, 'EACCES.*', true)
      }
      // 5 hits, 5 success (100%) → confidence should be 0.8
      const ep = memory.list('project').find((e) => e.type === 'error-pattern')
      if (ep && ep.type === 'error-pattern') {
        expect(ep.hitCount).toBe(5)
        expect(ep.confidence).toBeCloseTo(0.8, 2)
      }
    })
  })
})
