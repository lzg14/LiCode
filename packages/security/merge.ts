import type { SecurityConfig } from './index'
import { getDefaultWhitelist, BLOCKED_COMMANDS } from './whitelist'

export function getDefaultDeniedPaths(): string[] {
  return process.platform === 'win32'
    ? ['C:\\Windows', 'C:\\Program Files']
    : ['/etc', '/sys', '/proc']
}

const DEFAULT_SENSITIVE_PATTERNS = [
  'password', 'api_key', 'apikey', 'secret', 'token', 'private_key',
]

/**
 * 合并默认配置 + 用户配置（追加模式）
 * - 数组字段：追加 + 去重
 * - 标量字段：用户覆盖默认
 */
export function mergeSecurityConfig(
  defaults: Partial<SecurityConfig> | undefined,
  user: Partial<SecurityConfig> | undefined
): SecurityConfig {
  const d = defaults ?? {}
  const u = user ?? {}

  return {
    commandWhitelist: [
      ...new Set([...(d.commandWhitelist ?? []), ...(u.commandWhitelist ?? [])]),
    ],
    blockedCommands: [
      ...new Set([...(d.blockedCommands ?? []), ...(u.blockedCommands ?? [])]),
    ],
    allowedPaths: u.allowedPaths ?? d.allowedPaths ?? [],
    deniedPaths: [
      ...new Set([...(d.deniedPaths ?? []), ...(u.deniedPaths ?? [])]),
    ],
    maxFileSize: u.maxFileSize ?? d.maxFileSize ?? 10 * 1024 * 1024,
    sensitivePatterns: u.sensitivePatterns ?? d.sensitivePatterns ?? DEFAULT_SENSITIVE_PATTERNS,
  }
}

export const PLATFORM_DEFAULTS: SecurityConfig = {
  commandWhitelist: getDefaultWhitelist(),
  blockedCommands: [...BLOCKED_COMMANDS],
  allowedPaths: ['~'],
  deniedPaths: getDefaultDeniedPaths(),
  maxFileSize: 10 * 1024 * 1024,
  sensitivePatterns: [...DEFAULT_SENSITIVE_PATTERNS],
}
