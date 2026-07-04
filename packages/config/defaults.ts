import { PLATFORM_DEFAULTS } from '../security/merge'
import type { Config } from './schema'

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
