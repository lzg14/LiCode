import type { Config } from './schema'
import { PLATFORM_DEFAULTS } from '../security/merge'

/**
 * 默认配置
 *
 * security.commandWhitelist：开箱即用的平台默认白名单
 * 用户在 licode.config.json 配的 commandWhitelist 会**追加**到默认上
 * （见 packages/tui/app.tsx 的 merge 逻辑）
 */

export const DEFAULT_CONFIG: Config = {
  llm: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
  },
  security: PLATFORM_DEFAULTS,
  memory: {
    path: '~/.licode/licode-sessions.db',
    retentionDays: 30,
  },
  subagent: {
    maxConcurrent: 3,
    maxDepth: 1,
    timeoutMs: 900000,
    blockedTools: ['delegate_task', 'clarify', 'memory_write', 'send_message'],
  },
}

/**
 * 开发环境配置
 */
export const DEV_CONFIG: Partial<Config> = {
  llm: {
    provider: 'local',
    model: 'codellama',
  },
}

/**
 * 生产环境配置
 */
export const PROD_CONFIG: Partial<Config> = {}

/**
 * 获取环境配置
 */
export function getEnvironmentConfig(): Partial<Config> {
  const env = process.env.NODE_ENV || 'development'

  switch (env) {
    case 'production':
      return PROD_CONFIG
    case 'development':
      return DEV_CONFIG
    default:
      return {}
  }
}

/**
 * 合并默认配置
 */
export function mergeWithDefaults(config: Partial<Config>): Config {
  const envConfig = getEnvironmentConfig()
  const merged = { ...DEFAULT_CONFIG, ...envConfig, ...config }

  return merged as Config
}
