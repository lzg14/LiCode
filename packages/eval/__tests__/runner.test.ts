import { describe, expect, it } from 'vitest'
import { runScenarios } from '../src/runner'
import { generateReport } from '../src/report'
import { SCENARIOS } from '../src/scenarios.bench'
import { listScenarios } from '../index'
import { rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'

describe('eval framework', () => {
  describe('SCENARIOS', () => {
    it('should have at least 5 scenarios', () => {
      expect(SCENARIOS.length).toBeGreaterThanOrEqual(5)
    })

    it('should have unique ids', () => {
      const ids = new Set(SCENARIOS.map(s => s.id))
      expect(ids.size).toBe(SCENARIOS.length)
    })

    it('all scenarios have valid tier', () => {
      for (const s of SCENARIOS) {
        expect(['easy', 'medium', 'hard']).toContain(s.tier)
      }
    })

    it('all scenarios have non-empty prompt', () => {
      for (const s of SCENARIOS) {
        expect(s.prompt.length).toBeGreaterThan(0)
      }
    })
  })

  describe('listScenarios', () => {
    it('returns same as SCENARIOS', () => {
      expect(listScenarios()).toBe(SCENARIOS)
    })
  })

  describe('runScenarios', () => {
    it('returns RunResult for each scenario (mock mode)', async () => {
      const results = await runScenarios(SCENARIOS, { mock: true })
      expect(results.length).toBe(SCENARIOS.length)
      for (const r of results) {
        expect(r.scenarioId).toBeTruthy()
        expect(typeof r.success).toBe('boolean')
        expect(typeof r.turns).toBe('number')
        expect(Array.isArray(r.toolCalls)).toBe(true)
        expect(typeof r.latencyMs).toBe('number')
      }
    })

    it('calls setup and teardown', async () => {
      let setupCalled = false
      let teardownCalled = false
      const result = await runScenarios(
        [
          {
            id: 'test-setup',
            prompt: 'p',
            setup: async () => {
              setupCalled = true
            },
            teardown: async () => {
              teardownCalled = true
            },
            expect: { successCriteria: 'manual' },
            tier: 'easy',
          },
        ],
        { mock: true },
      )
      expect(setupCalled).toBe(true)
      expect(teardownCalled).toBe(true)
      expect(result).toHaveLength(1)
    })
  })

  describe('generateReport', () => {
    it('writes markdown and JSON to output dir', () => {
      const outDir = './eval-results-test'
      if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true })
      const results = [
        { scenarioId: 's1', success: true, turns: 2, toolCalls: [], latencyMs: 100, tokenCost: 10, errors: [] },
        { scenarioId: 's2', success: false, turns: 3, toolCalls: [], latencyMs: 200, tokenCost: 20, errors: ['oops'] },
      ]
      const mdPath = generateReport(results, outDir)
      expect(mdPath).toContain('.md')
      const today = new Date().toISOString().slice(0, 10)
      expect(mdPath).toContain(today)
      const jsonPath = join(outDir, 'reports', `${today}.json`)
      expect(existsSync(jsonPath)).toBe(true)
      // 清理
      rmSync(outDir, { recursive: true, force: true })
    })
  })
})
