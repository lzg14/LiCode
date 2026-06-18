import { isCommandAllowed, DEFAULT_WHITELIST, BLOCKED_COMMANDS } from './whitelist'
import { checkSensitivePath } from './sensitive'

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

const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  commandWhitelist: DEFAULT_WHITELIST,
  blockedCommands: BLOCKED_COMMANDS,
  allowedPaths: [],
  deniedPaths: ['/etc', '/sys', '/proc', 'C:\\Windows'],
  maxFileSize: 10 * 1024 * 1024, // 10MB
  sensitivePatterns: [
    'password',
    'api_key',
    'apikey',
    'secret',
    'token',
    'private_key',
  ],
}

export class SecurityLayer {
  private config: SecurityConfig

  constructor(config: Partial<SecurityConfig> = {}) {
    this.config = { ...DEFAULT_SECURITY_CONFIG, ...config }
  }

  /**
   * 检查命令是否允许执行
   */
  checkCommand(command: string): { allowed: boolean; reason?: string } {
    const base = command.split(' ')[0].toLowerCase()

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

    // 检查拒绝路径
    for (const denied of this.config.deniedPaths) {
      if (path.startsWith(denied)) {
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
      const regex = new RegExp(`${pattern}\\s*=\\s*['"]?[^'"]+['"]?`, 'gi')
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

export const securityLayer = new SecurityLayer()
