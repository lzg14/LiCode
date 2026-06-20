/**
 * 权限系统 - 参考 mimo-code 简化版
 * 支持 allow/deny/ask 三种权限级别
 */

import { z } from 'zod'

// ========== 类型定义 ==========

export type PermissionAction = 'allow' | 'deny' | 'ask'

export interface PermissionRule {
  tool: string
  pattern?: string
  action: PermissionAction
  reason?: string
}

export interface PermissionContext {
  tool: string
  args?: Record<string, unknown>
  cwd?: string
  sessionId?: string
}

// ========== Schema ==========

export const PermissionRuleSchema = z.object({
  tool: z.string(),
  pattern: z.string().optional(),
  action: z.enum(['allow', 'deny', 'ask']),
  reason: z.string().optional(),
})

export const PermissionConfigSchema = z.record(z.string(), z.union([
  z.enum(['allow', 'deny', 'ask']),
  z.array(z.object({
    pattern: z.string(),
    action: z.enum(['allow', 'deny', 'ask']),
    reason: z.string().optional(),
  })),
]))

// ========== PermissionManager ==========

export class PermissionManager {
  private rules: PermissionRule[] = []
  private defaults: Record<string, PermissionAction> = {}

  constructor(config?: Record<string, unknown>) {
    this.loadDefaults()
    if (config) {
      this.loadConfig(config)
    }
  }

  /**
   * 加载默认权限
   */
  private loadDefaults(): void {
    this.defaults = {
      // 基础工具 - 允许
      read: 'allow',
      glob: 'allow',
      grep: 'allow',
      codesearch: 'allow',
      stat: 'allow',
      list_directory: 'allow',
      bash: 'allow',
      datetime: 'allow',
      system_info: 'allow',
      env_vars: 'allow',

      // 写入工具 - 允许
      write: 'allow',
      edit: 'allow',
      create_directory: 'allow',
      move_file: 'allow',
      copy_file: 'allow',

      // 删除工具 - 谨慎
      delete_file: 'ask',

      // Git 工具
      git_status: 'allow',
      git_diff: 'allow',
      git_log: 'allow',
      git_commit: 'allow',

      // Web 工具
      webfetch: 'allow',
      websearch: 'allow',

      // 开发工具
      run_tests: 'allow',
      install_deps: 'ask',
    }
  }

  /**
   * 从配置加载权限
   */
  loadConfig(config: Record<string, unknown>): void {
    for (const [tool, value] of Object.entries(config)) {
      if (typeof value === 'string') {
        this.defaults[tool] = value as PermissionAction
      } else if (Array.isArray(value)) {
        for (const rule of value) {
          this.rules.push({
            tool,
            pattern: rule.pattern,
            action: rule.action,
            reason: rule.reason,
          })
        }
      }
    }
  }

  /**
   * 检查权限
   */
  check(context: PermissionContext): { allowed: boolean; action: PermissionAction; reason?: string } {
    // 1. 检查精确匹配规则
    for (const rule of this.rules) {
      if (rule.tool === context.tool) {
        if (rule.pattern) {
          const argsStr = JSON.stringify(context.args ?? {})
          if (argsStr.includes(rule.pattern)) {
            return { allowed: rule.action === 'allow', action: rule.action, reason: rule.reason }
          }
        } else {
          return { allowed: rule.action === 'allow', action: rule.action, reason: rule.reason }
        }
      }
    }

    // 2. 检查默认权限
    const defaultAction = this.defaults[context.tool] ?? 'ask'
    return { allowed: defaultAction === 'allow', action: defaultAction }
  }

  /**
   * 合并另一个 PermissionManager 的规则
   */
  merge(other: PermissionManager): void {
    // 合并默认权限
    for (const [tool, action] of Object.entries(other.defaults)) {
      this.defaults[tool] = action
    }

    // 合并规则
    this.rules.push(...other.rules)
  }

  /**
   * 添加规则
   */
  addRule(rule: PermissionRule): void {
    this.rules.push(rule)
  }

  /**
   * 移除规则
   */
  removeRule(tool: string, pattern?: string): void {
    this.rules = this.rules.filter(r => {
      if (r.tool !== tool) return true
      if (pattern && r.pattern !== pattern) return true
      return false
    })
  }

  /**
   * 获取所有规则
   */
  getRules(): PermissionRule[] {
    return [...this.rules]
  }

  /**
   * 获取默认权限
   */
  getDefaults(): Record<string, PermissionAction> {
    return { ...this.defaults }
  }

  /**
   * 导出配置
   */
  exportConfig(): Record<string, unknown> {
    const config: Record<string, unknown> = { ...this.defaults }

    // 将规则转换为配置格式
    for (const rule of this.rules) {
      if (!config[rule.tool]) {
        config[rule.tool] = []
      }
      if (Array.isArray(config[rule.tool])) {
        (config[rule.tool] as any[]).push({
          pattern: rule.pattern,
          action: rule.action,
          reason: rule.reason,
        })
      }
    }

    return config
  }
}

// ========== 预定义权限配置 ==========

export const PERMISSION_PRESETS = {
  /**
   * 主 Agent 权限（build 模式）
   */
  primary: {
    question: 'allow',
    plan_enter: 'allow',
    plan_exit: 'allow',
    skill: 'allow',
  },

  /**
   * 计划模式权限（只读）
   */
  plan: {
    '*': 'deny',
    read: 'allow',
    glob: 'allow',
    grep: 'allow',
    codesearch: 'allow',
    stat: 'allow',
    list_directory: 'allow',
    bash: 'allow',
    datetime: 'allow',
    system_info: 'allow',
  },

  /**
   * 探索模式权限（只读 + 搜索）
   */
  explore: {
    '*': 'deny',
    read: 'allow',
    glob: 'allow',
    grep: 'allow',
    codesearch: 'allow',
    stat: 'allow',
    list_directory: 'allow',
    bash: 'allow',
    webfetch: 'allow',
    websearch: 'allow',
    datetime: 'allow',
    system_info: 'allow',
  },

  /**
   * 子 Agent 权限（受限）
   */
  subagent: {
    question: 'deny',
    plan_enter: 'deny',
    plan_exit: 'deny',
    skill: 'deny',
  },

  /**
   * 最小权限（只读）
   */
  minimal: {
    '*': 'deny',
    read: 'allow',
    glob: 'allow',
    grep: 'allow',
  },
} as const

// ========== 工具函数 ==========

/**
 * 创建 PermissionManager
 */
export function createPermissionManager(
  preset?: keyof typeof PERMISSION_PRESETS,
  overrides?: Record<string, unknown>
): PermissionManager {
  const manager = new PermissionManager()

  if (preset) {
    manager.loadConfig(PERMISSION_PRESETS[preset] as Record<string, unknown>)
  }

  if (overrides) {
    manager.loadConfig(overrides)
  }

  return manager
}

/**
 * 合并多个权限配置
 */
export function mergePermissions(
  ...configs: Record<string, unknown>[]
): Record<string, unknown> {
  const merged: Record<string, unknown> = {}

  for (const config of configs) {
    for (const [key, value] of Object.entries(config)) {
      if (Array.isArray(value)) {
        if (!Array.isArray(merged[key])) {
          merged[key] = []
        }
        ;(merged[key] as any[]).push(...value)
      } else {
        merged[key] = value
      }
    }
  }

  return merged
}
