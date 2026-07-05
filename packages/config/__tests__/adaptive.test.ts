import { afterEach, describe, expect, it } from 'vitest'
import { _resetAdaptiveCache, generateAdaptiveConfig, getAdaptiveConfig } from '../adaptive'
import { _resetHardwareCache } from '../hardware'

afterEach(() => {
  _resetAdaptiveCache()
  _resetHardwareCache()
})

function makeProfile(tier: 'low' | 'medium' | 'high', isSSD = true) {
  const cores = tier === 'low' ? 2 : tier === 'medium' ? 4 : 16
  const totalGB = tier === 'low' ? 4 : tier === 'medium' ? 8 : 32
  return {
    cpu: { cores, model: 'test', speed: 0 },
    memory: { totalGB, freeGB: 0, usedPercent: 0 },
    platform: 'linux' as NodeJS.Platform,
    arch: 'x64',
    v8Version: 'test',
    isSSD,
    isContainer: false,
    hardwareTier: tier,
  }
}

describe('adaptive', () => {
  describe('generateAdaptiveConfig', () => {
    it('low tier: conservative values', () => {
      const cfg = generateAdaptiveConfig(makeProfile('low'))
      expect(cfg.subagent.maxConcurrent).toBe(2)
      expect(cfg.subagent.timeoutMs).toBe(120_000)
      expect(cfg.compaction.maxMessages).toBe(500)
      expect(cfg.compaction.maxTokens).toBe(100_000)
      expect(cfg.compaction.preserveRecent).toBe(50)
      expect(cfg.compaction.debounceMs).toBe(300_000)
      expect(cfg.llm.temperature).toBe(0.5)
      expect(cfg.llm.maxTokens).toBe(4096)
      expect(cfg.tool.batchSize).toBe(1)
      expect(cfg.tool.streamEnabled).toBe(false)
      expect(cfg.memory.cacheSizeMB).toBe(64)
      expect(cfg.memory.retentionDays).toBe(30)
      expect(cfg.disk.ioStrategy).toBe('batch')
    })

    it('medium tier: balanced values', () => {
      const cfg = generateAdaptiveConfig(makeProfile('medium'))
      expect(cfg.subagent.maxConcurrent).toBe(4)
      expect(cfg.subagent.timeoutMs).toBe(900_000)
      expect(cfg.compaction.maxMessages).toBe(1000)
      expect(cfg.compaction.maxTokens).toBe(200_000)
      expect(cfg.compaction.preserveRecent).toBe(100)
      expect(cfg.compaction.debounceMs).toBe(600_000)
      expect(cfg.llm.temperature).toBe(0.7)
      expect(cfg.llm.maxTokens).toBe(8192)
      expect(cfg.tool.batchSize).toBe(3)
      expect(cfg.tool.streamEnabled).toBe(true)
      expect(cfg.memory.cacheSizeMB).toBe(256)
      expect(cfg.memory.retentionDays).toBe(30)
      expect(cfg.disk.ioStrategy).toBe('batch') // medium SSD → batch
    })

    it('high tier: aggressive values', () => {
      const cfg = generateAdaptiveConfig(makeProfile('high'))
      expect(cfg.subagent.maxConcurrent).toBe(6)
      expect(cfg.compaction.maxMessages).toBe(2000)
      expect(cfg.compaction.maxTokens).toBe(400_000)
      expect(cfg.compaction.preserveRecent).toBe(200)
      expect(cfg.llm.maxTokens).toBe(16384)
      expect(cfg.tool.batchSize).toBe(5)
      expect(cfg.memory.cacheSizeMB).toBe(512)
      expect(cfg.memory.retentionDays).toBe(60)
      expect(cfg.disk.ioStrategy).toBe('stream') // high SSD → stream
    })

    it('HDD always → batch (any tier)', () => {
      expect(generateAdaptiveConfig(makeProfile('high', false)).disk.ioStrategy).toBe('batch')
      expect(generateAdaptiveConfig(makeProfile('medium', false)).disk.ioStrategy).toBe('batch')
      expect(generateAdaptiveConfig(makeProfile('low', false)).disk.ioStrategy).toBe('batch')
    })

    it('SSD + low/medium → batch (CPU bottleneck)', () => {
      expect(generateAdaptiveConfig(makeProfile('low', true)).disk.ioStrategy).toBe('batch')
      expect(generateAdaptiveConfig(makeProfile('medium', true)).disk.ioStrategy).toBe('batch')
    })
  })

  describe('getAdaptiveConfig', () => {
    it('returns config based on current hardware profile', () => {
      const cfg = getAdaptiveConfig()
      expect(typeof cfg.subagent.maxConcurrent).toBe('number')
      expect(cfg.subagent.maxConcurrent).toBeGreaterThan(0)
      expect(cfg.llm.temperature).toBeGreaterThan(0)
      expect(cfg.llm.temperature).toBeLessThanOrEqual(1)
    })

    it('caches result', () => {
      const a = getAdaptiveConfig()
      const b = getAdaptiveConfig()
      expect(a).toBe(b)
    })
  })
})
