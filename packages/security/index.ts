import { isCommandAllowed, getDefaultWhitelist, DEFAULT_WHITELIST, BLOCKED_COMMANDS } from './whitelist'
import { checkSensitivePath } from './sensitive'

// 导出权限系统
export {
  PermissionManager,
  PERMISSION_PRESETS,
  createPermissionManager,
  mergePermissions,
  PermissionRuleSchema,
  PermissionConfigSchema,
} from './permission'
export type { PermissionAction, PermissionRule, PermissionContext } from './permission'

/**
 * 危险命令模式 - 需要二次确认
 */
export const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /rm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+|-\s+f\s+).*\//g, description: '强制递归删除' },
  { pattern: /rm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+|-\s+r\s+).*\//g, description: '递归删除目录' },
  { pattern: /curl\s+.*\|\s*(ba)?sh/g, description: 'curl 管道执行脚本' },
  { pattern: /wget\s+.*\|\s*(ba)?sh/g, description: 'wget 管道执行脚本' },
  { pattern: /sudo\s+/g, description: '使用 sudo 提权' },
  { pattern: /chmod\s+777/g, description: '给所有人写权限' },
  { pattern: /chmod\s+-R\s+777/g, description: '递归给所有人写权限' },
  { pattern: /mkfs\./g, description: '格式化磁盘' },
  { pattern: /dd\s+if=/g, description: 'dd 裸写磁盘' },
  { pattern: />\s*\/dev\/sd[a-z]/g, description: '直接写磁盘设备' },
  // PowerShell 危险模式
  { pattern: /Remove-Item\s+(-Recurse|-Force|-rf)\b/gi, description: 'PowerShell 强制删除' },
  { pattern: /Set-ExecutionPolicy\s+Unrestricted/gi, description: '禁用 PowerShell 执行策略' },
  { pattern: /Invoke-Expression\b/gi, description: 'PowerShell 动态执行' },
  { pattern: /\|\s*iex\b/gi, description: 'iex 管道执行' },
  { pattern: /Clear-RecycleBin\s+-Force/gi, description: '清空回收站' },
  { pattern: /Format-Volume\b/gi, description: '格式化磁盘' },
  { pattern: /Stop-Service\s+-Force/gi, description: '强制停止系统服务' },
]

/**
 * 检查命令是否包含危险模式
 */
export function checkDangerousPattern(command: string): { dangerous: boolean; reason?: string } {
  for (const { pattern, description } of DANGEROUS_PATTERNS) {
    pattern.lastIndex = 0
    if (pattern.test(command)) {
      return { dangerous: true, reason: `检测到危险操作: ${description}` }
    }
  }
  return { dangerous: false }
}

/**
 * 安全层 - 集成命令白名单、文件系统边界、敏感信息检测
 */

export interface SecurityConfig {
  commandWhitelist: string[]
  blockedCommands: string[]
  allowedPaths: string[]
  deniedPaths: string[]
  maxFileSize: number
  sensitivePatterns: string[]
}

export function getDefaultDeniedPaths(): string[] {
  return process.platform === 'win32'
    ? ['C:\\Windows', 'C:\\Program Files']
    : ['/etc', '/sys', '/proc']
}

export class SecurityLayer {
  config: SecurityConfig

  constructor(config: Partial<SecurityConfig> = {}) {
    this.config = {
      commandWhitelist: getDefaultWhitelist(),
      blockedCommands: BLOCKED_COMMANDS,
      allowedPaths: [],
      deniedPaths: getDefaultDeniedPaths(),
      maxFileSize: 10 * 1024 * 1024,
      sensitivePatterns: ['password', 'api_key', 'apikey', 'secret', 'token', 'private_key'],
      ...config,
    }
  }

  /**
   * 检查命令是否允许执行
   */
  checkCommand(command: string): { allowed: boolean; reason?: string } {
    const trimmed = command.trim()
    if (!trimmed) {
      return { allowed: false, reason: '命令为空' }
    }
    const base = trimmed.split(' ')[0].toLowerCase()

    // 检查黑名单
    if (this.config.blockedCommands.includes(base)) {
      return {
        allowed: false,
        reason: `命令 "${base}" 在黑名单中，禁止执行`,
      }
    }

    // 检查白名单
    if (!this.config.commandWhitelist.includes(base)) {
      return {
        allowed: false,
        reason: `命令 "${base}" 不在白名单中`,
      }
    }

    return { allowed: true }
  }

  /**
   * 检查文件路径是否允许访问
   */
  checkPath(path: string): { allowed: boolean; reason?: string } {
    // 检查敏感路径
    const sensitiveWarning = checkSensitivePath(path)
    if (sensitiveWarning) {
      return {
        allowed: false,
        reason: sensitiveWarning.reason,
      }
    }

    // 规范化路径分隔符后检查拒绝路径
    const normalizedPath = path.replace(/\\/g, '/')
    for (const denied of this.config.deniedPaths) {
      const normalizedDenied = denied.replace(/\\/g, '/')
      if (normalizedPath.startsWith(normalizedDenied)) {
        return {
          allowed: false,
          reason: `路径 "${path}" 在拒绝列表中`,
        }
      }
    }

    return { allowed: true }
  }

  /**
   * 检查文件大小是否允许
   */
  checkFileSize(size: number): { allowed: boolean; reason?: string } {
    if (size < 0) {
      return { allowed: false, reason: `文件大小 ${size} 不合法` }
    }
    if (size > this.config.maxFileSize) {
      return {
        allowed: false,
        reason: `文件大小 ${size} 超过限制 ${this.config.maxFileSize}`,
      }
    }
    return { allowed: true }
  }

  /**
   * 检查内容是否包含敏感信息
   */
  checkSensitiveContent(content: string): { detected: boolean; patterns: string[] } {
    const detected: string[] = []

    for (const pattern of this.config.sensitivePatterns) {
      const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const regex = new RegExp(`${escaped}\\s*=\\s*['"]?[^'"]+['"]?`, 'gi')
      if (regex.test(content)) {
        detected.push(pattern)
      }
    }

    return {
      detected: detected.length > 0,
      patterns: detected,
    }
  }

  /**
   * 综合安全检查
   */
  fullCheck(params: {
    command?: string
    path?: string
    content?: string
    fileSize?: number
  }): { safe: boolean; issues: string[] } {
    const issues: string[] = []

    if (params.command) {
      const cmdResult = this.checkCommand(params.command)
      if (!cmdResult.allowed && cmdResult.reason) {
        issues.push(cmdResult.reason)
      }
    }

    if (params.path) {
      const pathResult = this.checkPath(params.path)
      if (!pathResult.allowed && pathResult.reason) {
        issues.push(pathResult.reason)
      }
    }

    if (params.fileSize !== undefined) {
      const sizeResult = this.checkFileSize(params.fileSize)
      if (!sizeResult.allowed && sizeResult.reason) {
        issues.push(sizeResult.reason)
      }
    }

    if (params.content) {
      const contentResult = this.checkSensitiveContent(params.content)
      if (contentResult.detected) {
        issues.push(`检测到敏感信息模式: ${contentResult.patterns.join(', ')}`)
      }
    }

    return {
      safe: issues.length === 0,
      issues,
    }
  }
}

/**
 * 创建带 config 的 SecurityLayer 实例
 */
export function createSecurityLayer(config?: Partial<SecurityConfig>): SecurityLayer {
  return new SecurityLayer(config)
}

// 当前生效的 securityLayer 实例（可在启动时替换）
let _activeSecurityLayer: SecurityLayer = new SecurityLayer()

export function setSecurityLayer(instance: SecurityLayer): void {
  _activeSecurityLayer = instance
}

export function getSecurityLayer(): SecurityLayer {
  return _activeSecurityLayer
}

// 向后兼容的单例 export（deprecated，优先用 getSecurityLayer()）
export const securityLayer = _activeSecurityLayer
