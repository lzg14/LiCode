import type { HardwareProfile } from './hardware'
import { getHardwareProfile } from './hardware'

/**
 * 硬件自适应配置（M1 智能增强 §4.M1）
 *
 * 根据 hardwareTier + isSSD 映射出运行时参数，
 * 替换 packages/core/{subagent,session-compactor}.ts 的硬编码值。
 *
 * 设计文档：docs/plans/hardware-adaptive-design.md §3
 */
export interface AdaptiveConfig {
  subagent: {
    maxConcurrent: number
    timeoutMs: number
  }
  compaction: {
    maxMessages: number
    maxTokens: number
    preserveRecent: number
    debounceMs: number
  }
  llm: {
    temperature: number
    maxTokens: number
  }
  tool: {
    batchSize: number
    streamEnabled: boolean
  }
  memory: {
    cacheSizeMB: number
    retentionDays: number
  }
  disk: {
    ioStrategy: 'batch' | 'stream'
  }
}

let cachedConfig: AdaptiveConfig | null = null

/**
 * 获取自适应配置（基于硬件 profile）
 *
 * 调用 getHardwareProfile() 一次，缓存结果。
 * 启动后修改硬件（不可能）不会反映到 config。
 */
export function getAdaptiveConfig(): AdaptiveConfig {
  if (cachedConfig) return cachedConfig
  const profile = getHardwareProfile()
  cachedConfig = generateAdaptiveConfig(profile)
  return cachedConfig
}

/** 重置缓存（仅供测试）*/
export function _resetAdaptiveCache(): void {
  cachedConfig = null
}

/**
 * 根据硬件 profile 生成自适应配置
 */
export function generateAdaptiveConfig(profile: HardwareProfile): AdaptiveConfig {
  const tier = profile.hardwareTier
  const isSSD = profile.isSSD

  return {
    subagent: tierMap(tier, {
      low: { maxConcurrent: 2, timeoutMs: 120_000 },
      medium: { maxConcurrent: 4, timeoutMs: 900_000 },
      high: { maxConcurrent: 6, timeoutMs: 900_000 },
    }),
    compaction: tierMap(tier, {
      low: { maxMessages: 500, maxTokens: 100_000, preserveRecent: 50, debounceMs: 300_000 },
      medium: { maxMessages: 1000, maxTokens: 200_000, preserveRecent: 100, debounceMs: 600_000 },
      high: { maxMessages: 2000, maxTokens: 400_000, preserveRecent: 200, debounceMs: 600_000 },
    }),
    llm: tierMap(tier, {
      low: { temperature: 0.5, maxTokens: 4096 },
      medium: { temperature: 0.7, maxTokens: 8192 },
      high: { temperature: 0.7, maxTokens: 16384 },
    }),
    tool: tierMap(tier, {
      low: { batchSize: 1, streamEnabled: false },
      medium: { batchSize: 3, streamEnabled: true },
      high: { batchSize: 5, streamEnabled: true },
    }),
    memory: tierMap(tier, {
      low: { cacheSizeMB: 64, retentionDays: 30 },
      medium: { cacheSizeMB: 256, retentionDays: 30 },
      high: { cacheSizeMB: 512, retentionDays: 60 },
    }),
    disk: {
      // SSD + high 性能 → stream
      // HDD 任何 tier → batch
      // SSD + low/medium → batch（CPU 限制并发）
      ioStrategy: !isSSD ? 'batch' : tier === 'high' ? 'stream' : 'batch',
    },
  }
}

/**
 * 合并自适应配置到主配置（subagent.maxConcurrent 等覆盖 default）
 *
 * 规则：用户显式配置 > 自适应默认
 * 当前实现：自适应是 runtime override，不进 user config schema。
 * 调用方按需读取 getAdaptiveConfig() 替换硬编码。
 */
export function mergeAdaptiveConfig<T extends Record<string, unknown>>(
  base: T,
  _adaptive: AdaptiveConfig,
): T {
  // 当前 subagent.maxConcurrent 等已在 base 中由 schema 验证，
  // 自适应仅作为 reference 供调用方按需读取。
  return base
}

function tierMap<K extends string, V>(
  tier: 'low' | 'medium' | 'high',
  table: Record<'low' | 'medium' | 'high', V>,
): V {
  return table[tier]
}
