// IntelligenceRecorder — afterExecute 写 M4 schema 到 Memory
// v2 plan §4.M4: "在工具执行后 recorder.record(toolName, success, duration)"
// v2 plan §4.M5: "afterExecute(ctx, result) 写入 Memory (recorder)"
//
// 设计：
// - id 模式 `tool-stats:<projectId>:<tool>` / `user-pref:<projectId>:<category>:<signal>` / `error-pattern:<projectId>:<pattern>`
// - upsert 语义（依赖 Memory.writeRaw）
// - 失败不 throw — 只 devLogger.warn，adapter 不 crash

import { Buffer } from 'node:buffer'
import { devLogger } from '../dev-logger'
import {
  recordErrorPattern,
  recordUserPref,
  updateToolStats,
  type ErrorPatternEntry,
  type ToolStatsEntry,
  type UserPrefEntry,
} from '../../memory/schema'
import type { Memory } from '../../memory/memory'
import type { IntelligenceContext, ToolCallEvent } from './types'

function projectId(cwd: string): string {
  return Buffer.from(cwd).toString('base64').slice(0, 16)
}

/** 按 id 找已有 entry（v2 entries: tool-stats / user-pref / error-pattern） */
function findById(memory: Memory, id: string): unknown {
  // Memory.entries 是 private — 用 list() 找
  return memory.list('project').find((e) => e.id === id)
    ?? memory.list('global').find((e) => e.id === id)
}

export class IntelligenceRecorder {
  /**
   * 记录一次 tool 调用到 tool-stats（M4 schema 累加）
   */
  async recordToolCall(ictx: IntelligenceContext, event: ToolCallEvent): Promise<void> {
    try {
      const pid = projectId(ictx.cwd)
      // id 模式：tool-stats-<projectId>-<tool>
      // 用 `-` 而非 `:` 作分隔符：Windows 文件名禁止 `:`，跨平台统一更安全
      const id = `tool-stats-${pid}-${event.tool}`
      const current = findById(ictx.memory, id) as ToolStatsEntry | undefined
      const updated = updateToolStats(current, event.tool, {
        success: event.success,
        durationMs: event.durationMs,
        timeout: event.timeout,
      })
      // 强制 id 一致（updateToolStats 默认用 `<tool>-<now>`，覆盖为稳定 id）
      const finalEntry: ToolStatsEntry = { ...updated, id, scope: 'project' }
      await ictx.memory.writeRaw(finalEntry)
    } catch (e) {
      devLogger.warn('INTEL', `recordToolCall(${event.tool}) failed: ${e}`)
    }
  }

  /**
   * 记录一次 user 偏好信号到 user-pref
   */
  async recordUserPref(
    ictx: IntelligenceContext,
    signal: string,
    category: UserPrefEntry['category'],
  ): Promise<void> {
    try {
      const pid = projectId(ictx.cwd)
      const id = `user-pref-${pid}-${category}-${signal}`
      const current = findById(ictx.memory, id) as UserPrefEntry | undefined
      const updated = recordUserPref(current, signal, category)
      const finalEntry: UserPrefEntry = { ...updated, id, scope: 'project' }
      await ictx.memory.writeRaw(finalEntry)
    } catch (e) {
      devLogger.warn('INTEL', `recordUserPref(${signal}) failed: ${e}`)
    }
  }

  /**
   * 记录一次 error-pattern 命中（M6 占位 — 完整 autoFix 逻辑后续）
   */
  async recordErrorPattern(
    ictx: IntelligenceContext,
    pattern: string,
    autoFixApplied: boolean,
  ): Promise<void> {
    try {
      const pid = projectId(ictx.cwd)
      const id = `error-pattern-${pid}-${pattern}`
      const current = findById(ictx.memory, id) as ErrorPatternEntry | undefined
      const updated = recordErrorPattern(current, pattern, autoFixApplied)
      const finalEntry: ErrorPatternEntry = { ...updated, id, scope: 'project' }
      await ictx.memory.writeRaw(finalEntry)
    } catch (e) {
      devLogger.warn('INTEL', `recordErrorPattern(${pattern}) failed: ${e}`)
    }
  }
}
