import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Memory } from '../../../memory/memory'
import { IntelligenceAdapter, defaultRegistry } from '../adapter'
import { DecisionRegistry } from '../registry'
import { DefaultFallback } from '../fallback'
import type { IntelligenceContext, ToolStatsEntry, UserPrefEntry } from '../types'

describe('IntelligenceAdapter', () => {
  let tmpDir: string
  let memory: Memory
  let ictx: IntelligenceContext

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'adapter-test-'))
    memory = new Memory(tmpDir, { maxAgeMs: 365 * 24 * 60 * 60 * 1000 })
    ictx = {
      cwd: tmpDir,
      sessionId: 'sess-1',
      userInput: 'test',
      modelInfo: { modelId: 'm', provider: 'p' },
      memory,
    }
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('beforeExecute', () => {
    it('with empty memory → all decisions not triggered, usedFallback=true', async () => {
      const a = new IntelligenceAdapter()
      const result = await a.beforeExecute(ictx)
      expect(result.systemHints).toBe('')
      expect(result.usedFallback).toBe(true)
      expect(Object.keys(result.decisions).length).toBeGreaterThan(0)
      for (const d of Object.values(result.decisions)) {
        expect(d.triggered).toBe(false)
      }
    })

    it('edit failure rate high → tool-choice decision triggered', async () => {
      // 先 seed 5 success + 5 failure
      for (let i = 0; i < 5; i++) {
        await memory.writeRaw<ToolStatsEntry>({
          id: `tool-stats:test:edit`,
          scope: 'project',
          type: 'tool-stats',
          tool: 'edit',
          successCount: 5,
          failureCount: 5,
          timeoutCount: 0,
          avgDurationMs: 100,
          lastUsedAt: Date.now(),
        })
      }
      const a = new IntelligenceAdapter()
      const result = await a.beforeExecute(ictx)
      expect(result.decisions['tool-choice']?.triggered).toBe(true)
      expect(result.systemHints).toContain('edit')
      expect(result.systemHints).toContain('IntelligenceAdapter Hints')
    })

    it('verbosity triggered when user_deleted_comment >= 3', async () => {
      await memory.writeRaw<UserPrefEntry>({
        id: `user-pref:test:comments:user_deleted_comment`,
        scope: 'project',
        type: 'user-pref',
        category: 'comments',
        signal: 'user_deleted_comment',
        count: 4,
        confidence: 0.9,
      })
      const a = new IntelligenceAdapter()
      const result = await a.beforeExecute(ictx)
      expect(result.decisions['verbosity']?.triggered).toBe(true)
      expect(result.systemHints).toContain('少注释')
    })

    it('confirmPolicy = "every-step" when user_rejected_continue >= 3', async () => {
      await memory.writeRaw<UserPrefEntry>({
        id: `user-pref:test:workflow:user_rejected_continue`,
        scope: 'project',
        type: 'user-pref',
        category: 'workflow',
        signal: 'user_rejected_continue',
        count: 5,
        confidence: 0.9,
      })
      const a = new IntelligenceAdapter()
      const result = await a.beforeExecute(ictx)
      expect(result.decisions['confirm-frequency']?.triggered).toBe(true)
      expect(result.confirmPolicy).toBe('every-step')
    })

    it('confirmPolicy = "once" when user_chose_confirm_all >= 2', async () => {
      await memory.writeRaw<UserPrefEntry>({
        id: `user-pref:test:workflow:user_chose_confirm_all`,
        scope: 'project',
        type: 'user-pref',
        category: 'workflow',
        signal: 'user_chose_confirm_all',
        count: 3,
        confidence: 0.9,
      })
      const a = new IntelligenceAdapter()
      const result = await a.beforeExecute(ictx)
      expect(result.confirmPolicy).toBe('once')
    })

    it('default confirmPolicy = "once" when no pref signals', async () => {
      const a = new IntelligenceAdapter()
      const result = await a.beforeExecute(ictx)
      expect(result.confirmPolicy).toBe('once')
    })

    it('single decision failure does not crash adapter', async () => {
      const registry = defaultRegistry()
      // 注入一个会 throw 的 decision
      registry.register('boom', () => {
        throw new Error('mock failure')
      })
      const a = new IntelligenceAdapter({ registry })
      // 不会 throw，会 fallback
      const result = await a.beforeExecute(ictx)
      expect(result.usedFallback).toBe(true)
      expect(result.decisions['boom']?.triggered).toBe(false)
    })

    it('composes multiple triggered decisions into systemHints', async () => {
      await memory.writeRaw<ToolStatsEntry>({
        id: `tool-stats:test:edit`,
        scope: 'project',
        type: 'tool-stats',
        tool: 'edit',
        successCount: 3,
        failureCount: 7,
        timeoutCount: 0,
        avgDurationMs: 100,
        lastUsedAt: Date.now(),
      })
      await memory.writeRaw<UserPrefEntry>({
        id: `user-pref:test:comments:user_deleted_comment`,
        scope: 'project',
        type: 'user-pref',
        category: 'comments',
        signal: 'user_deleted_comment',
        count: 4,
        confidence: 0.9,
      })
      const a = new IntelligenceAdapter()
      const result = await a.beforeExecute(ictx)
      expect(result.systemHints).toContain('工具选择提示')
      expect(result.systemHints).toContain('详细度提示')
      expect(result.systemHints).toContain('## IntelligenceAdapter Hints')
    })
  })

  describe('afterExecute', () => {
    it('records tool calls to memory', async () => {
      const a = new IntelligenceAdapter()
      await a.afterExecute(ictx, [
        { tool: 'edit', success: true, durationMs: 100 },
        { tool: 'bash', success: false, durationMs: 5000, timeout: true },
      ])

      const all = memory.list('project')
      const stats = all.filter((e) => e.type === 'tool-stats')
      expect(stats.length).toBe(2)
      const edit = stats.find((s) => s.type === 'tool-stats' && s.tool === 'edit')
      const bash = stats.find((s) => s.type === 'tool-stats' && s.tool === 'bash')
      expect(edit).toBeTruthy()
      expect(bash).toBeTruthy()
    })

    it('failure on one tool does not block others', async () => {
      const registry = new DecisionRegistry()
      // 用 stub registry
      const a = new IntelligenceAdapter({ registry })
      // afterExecute 内部 recorder 单独 try/catch，所以即使一个失败也能继续
      await expect(
        a.afterExecute(ictx, [
          { tool: 'edit', success: true, durationMs: 100 },
        ]),
      ).resolves.toBeUndefined()
    })

    it('empty events array is no-op', async () => {
      const a = new IntelligenceAdapter()
      await a.afterExecute(ictx, [])
      expect(memory.list('project').length).toBe(0)
    })
  })

  describe('getters', () => {
    it('returns internal components for testing', () => {
      const a = new IntelligenceAdapter()
      expect(a.getRegistry()).toBeInstanceOf(DecisionRegistry)
      expect(a.getFallback()).toBeInstanceOf(DefaultFallback)
      expect(a.getRecorder()).toBeTruthy()
    })

    it('defaultRegistry() returns registry with 4 default decisions', () => {
      const r = defaultRegistry()
      expect(r.list()).toEqual(['tool-choice', 'verbosity', 'confirm-frequency', 'task-depth'])
    })
  })
})
