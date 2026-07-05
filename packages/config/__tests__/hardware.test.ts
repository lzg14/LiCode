import { afterEach, describe, expect, it } from 'vitest'
import { _resetHardwareCache, calculateTier, getHardwareProfile } from '../hardware'

afterEach(() => _resetHardwareCache())

describe('hardware', () => {
  describe('getHardwareProfile', () => {
    it('should return a valid profile', () => {
      const profile = getHardwareProfile()
      expect(profile.cpu.cores).toBeGreaterThan(0)
      expect(profile.cpu.model).toBeTypeOf('string')
      expect(profile.cpu.speed).toBeGreaterThanOrEqual(0)
      expect(profile.memory.totalGB).toBeGreaterThan(0)
      expect(profile.memory.freeGB).toBeGreaterThanOrEqual(0)
      expect(profile.memory.usedPercent).toBeGreaterThanOrEqual(0)
      expect(profile.memory.usedPercent).toBeLessThanOrEqual(100)
      expect(['low', 'medium', 'high']).toContain(profile.hardwareTier)
    })

    it('should cache profile (same instance on second call)', () => {
      const a = getHardwareProfile()
      const b = getHardwareProfile()
      expect(a).toBe(b)
    })

    it('should reset cache when _resetHardwareCache called', () => {
      const a = getHardwareProfile()
      _resetHardwareCache()
      const b = getHardwareProfile()
      expect(a).not.toBe(b)
      expect(a.cpu.cores).toBe(b.cpu.cores)
    })

    it('should have non-negative freeGB and totalGB', () => {
      const profile = getHardwareProfile()
      expect(profile.memory.freeGB).toBeLessThanOrEqual(profile.memory.totalGB)
    })
  })

  describe('calculateTier', () => {
    it('low: 2 cores + 4GB', () => {
      expect(calculateTier({ cpu: { cores: 2, model: 'x', speed: 0 }, memory: { totalGB: 4, freeGB: 0, usedPercent: 0 } })).toBe('low')
    })

    it('low: 1 core + 8GB (cores dominate)', () => {
      expect(calculateTier({ cpu: { cores: 1, model: 'x', speed: 0 }, memory: { totalGB: 8, freeGB: 0, usedPercent: 0 } })).toBe('low')
    })

    it('low: 4 cores + 2GB (memory dominates)', () => {
      expect(calculateTier({ cpu: { cores: 4, model: 'x', speed: 0 }, memory: { totalGB: 2, freeGB: 0, usedPercent: 0 } })).toBe('low')
    })

    it('medium: 4 cores + 8GB', () => {
      expect(calculateTier({ cpu: { cores: 4, model: 'x', speed: 0 }, memory: { totalGB: 8, freeGB: 0, usedPercent: 0 } })).toBe('medium')
    })

    it('medium: 8 cores + 8GB', () => {
      expect(calculateTier({ cpu: { cores: 8, model: 'x', speed: 0 }, memory: { totalGB: 8, freeGB: 0, usedPercent: 0 } })).toBe('medium')
    })

    it('high: 16 cores + 32GB', () => {
      expect(calculateTier({ cpu: { cores: 16, model: 'x', speed: 0 }, memory: { totalGB: 32, freeGB: 0, usedPercent: 0 } })).toBe('high')
    })

    it('high: 16 cores + 8GB (cores dominate)', () => {
      expect(calculateTier({ cpu: { cores: 16, model: 'x', speed: 0 }, memory: { totalGB: 8, freeGB: 0, usedPercent: 0 } })).toBe('high')
    })

    it('container: 1 core should be low (not medium)', () => {
      // 容器环境保守降级：1 核 → low
      expect(
        calculateTier(
          { cpu: { cores: 1, model: 'x', speed: 0 }, memory: { totalGB: 8, freeGB: 0, usedPercent: 0 } },
          true,
        ),
      ).toBe('low')
    })

    it('container: 4 cores + 8GB → medium (not high)', () => {
      // 容器环境保守：4 核 + 8GB 不是 high
      expect(
        calculateTier(
          { cpu: { cores: 4, model: 'x', speed: 0 }, memory: { totalGB: 8, freeGB: 0, usedPercent: 0 } },
          true,
        ),
      ).toBe('medium')
    })

    it('container: 8 cores + 16GB → high', () => {
      expect(
        calculateTier(
          { cpu: { cores: 8, model: 'x', speed: 0 }, memory: { totalGB: 16, freeGB: 0, usedPercent: 0 } },
          true,
        ),
      ).toBe('high')
    })
  })
})
