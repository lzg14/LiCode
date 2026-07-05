// 旧 entries（向后兼容，不要改 type 字段顺序）
export interface MemoryEntry {
  id: string
  scope: 'global' | 'project' | 'session'
  type: 'memory' | 'notes' | 'checkpoint' | 'progress' | 'feedback'
  content: string
  createdAt: number
  updatedAt: number
  accessCount: number
}

export interface MemorySearchResult {
  id: string
  content: string
  score: number
}

// ============================================================
// v2 智能增强 §4.M4：M4 「记忆与学习」扩展
// 详细设计: docs/plans/intelligence-enhancement-plan.md §4.M4 + §2.2
//
// 原则：
// 1. 向后兼容 — 旧 MemoryEntry 完全不动
// 2. 不新建 ~/.licode/learning/ 目录 — 复用 packages/memory
// 3. type 字段扩展为 discriminated union
// ============================================================

/** 基础字段（所有 v2 entries 共享）*/
export interface MemoryEntryBase {
  id: string
  scope: 'global' | 'project' | 'session'
  createdAt: number
  updatedAt: number
  accessCount: number
  projectId?: string
  tags?: string[]
}

// ===== M4: 工具调用统计 =====

export interface ToolStatsEntry extends MemoryEntryBase {
  type: 'tool-stats'
  /** 工具名：'edit' | 'read' | 'bash' | 'grep' | 'glob' | 'codesearch' | ... */
  tool: string
  successCount: number
  failureCount: number
  /** timeout 失败计数（高频时提示用户拆分命令）*/
  timeoutCount: number
  /** 平均耗时 ms */
  avgDurationMs: number
  /** 最近一次使用时间戳 */
  lastUsedAt: number
}

// ===== M4: 用户偏好/纠正 =====

export type UserPrefCategory = 'comments' | 'types' | 'naming' | 'style' | 'workflow'

export interface UserPrefEntry extends MemoryEntryBase {
  type: 'user-pref'
  category: UserPrefCategory
  /** 信号: 'user_deleted_comment' | 'user_added_type' | ... */
  signal: string
  /** 累计次数（>3 → 高置信）*/
  count: number
  /** 0-1 */
  confidence: number
}

// ===== M6: 错误模式 =====

export interface ErrorPatternEntry extends MemoryEntryBase {
  type: 'error-pattern'
  /** 正则匹配错误消息 */
  pattern: string
  /** 自动修复模板（可选）*/
  autoFix?: string
  /** 命中次数 */
  hitCount: number
  /** 成功修复次数（autoFix 应用后问题消失）*/
  successFixCount: number
  /** 0-1，hitCount > 5 + successFixCount/hitCount > 0.8 → 0.8+ */
  confidence: number
}

// ===== Discriminated union =====

/** 任意 MemoryEntry（M4 之前的）*/
export type LegacyMemoryEntry = MemoryEntry

/** 任意 v2 entry（包含 M4/M6 扩展）*/
export type AnyMemoryEntry = MemoryEntry | ToolStatsEntry | UserPrefEntry | ErrorPatternEntry

// ===== v2 行为统计辅助 =====

/**
 * 更新 tool-stats 累计计数
 * 纯函数：传入当前 entry + 新事件，返回新 entry
 */
export function updateToolStats(
  current: ToolStatsEntry | undefined,
  tool: string,
  result: { success: boolean; durationMs: number; timeout?: boolean },
): ToolStatsEntry {
  const now = Date.now()
  if (!current) {
    return {
      id: `${tool}-${now}`,
      scope: 'project',
      type: 'tool-stats',
      tool,
      successCount: result.success ? 1 : 0,
      failureCount: result.success ? 0 : 1,
      timeoutCount: result.timeout ? 1 : 0,
      avgDurationMs: result.durationMs,
      lastUsedAt: now,
      createdAt: now,
      updatedAt: now,
      accessCount: 1,
    }
  }
  const totalCalls = current.successCount + current.failureCount + 1
  const newAvg = (current.avgDurationMs * (totalCalls - 1) + result.durationMs) / totalCalls
  return {
    ...current,
    successCount: current.successCount + (result.success ? 1 : 0),
    failureCount: current.failureCount + (result.success ? 0 : 1),
    timeoutCount: current.timeoutCount + (result.timeout ? 1 : 0),
    avgDurationMs: newAvg,
    lastUsedAt: now,
    updatedAt: now,
    accessCount: current.accessCount + 1,
  }
}

/**
 * 累加 user-pref 计数
 */
export function recordUserPref(
  current: UserPrefEntry | undefined,
  signal: string,
  category: UserPrefCategory,
): UserPrefEntry {
  const now = Date.now()
  if (!current) {
    return {
      id: `${category}-${signal}-${now}`,
      scope: 'project',
      type: 'user-pref',
      category,
      signal,
      count: 1,
      confidence: 0.3, // 0.1 + 1 * 0.2
      createdAt: now,
      updatedAt: now,
      accessCount: 1,
    }
  }
  const newCount = current.count + 1
  // 置信度 0.1 + min(0.9, newCount * 0.2)，3 次后 ≈ 0.7
  const newConfidence = Math.min(0.9, 0.1 + newCount * 0.2)
  return {
    ...current,
    count: newCount,
    confidence: newConfidence,
    updatedAt: now,
    accessCount: current.accessCount + 1,
  }
}

/**
 * 累加 error-pattern 命中
 */
export function recordErrorPattern(
  current: ErrorPatternEntry | undefined,
  pattern: string,
  autoFixApplied: boolean,
): ErrorPatternEntry {
  const now = Date.now()
  if (!current) {
    return {
      id: `error-pattern-${pattern}-${now}`,
      scope: 'project',
      type: 'error-pattern',
      pattern,
      hitCount: 1,
      successFixCount: autoFixApplied ? 1 : 0,
      confidence: 0.1,
      createdAt: now,
      updatedAt: now,
      accessCount: 1,
    }
  }
  const newHitCount = current.hitCount + 1
  const newSuccessFixCount = current.successFixCount + (autoFixApplied ? 1 : 0)
  const newConfidence = newHitCount >= 5 && newSuccessFixCount / newHitCount > 0.8 ? 0.8 : 0.1
  return {
    ...current,
    hitCount: newHitCount,
    successFixCount: newSuccessFixCount,
    confidence: newConfidence,
    updatedAt: now,
    accessCount: current.accessCount + 1,
  }
}
