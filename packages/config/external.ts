import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface ClaudeCodeConfig {
  apiKey: string
  baseUrl: string
  model: string
}

export function importClaudeCodeConfig(): ClaudeCodeConfig | null {
  const settingsPath = join(homedir(), '.claude', 'settings.json')
  if (!existsSync(settingsPath)) {
    return null
  }

  try {
    const content = readFileSync(settingsPath, 'utf-8')
    const settings = JSON.parse(content)

    const env = settings?.env
    if (!env) return null

    // 优先使用 ANTHROPIC_AUTH_TOKEN，如果没有则尝试 ANTHROPIC_API_KEY
    const apiKey = env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY
    if (!apiKey) return null

    let baseUrl = env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'
    // @ai-sdk/anthropic 期望 baseUrl 以 /v1 结尾，否则会拼出错误路径
    // 例如：https://api.xiaomimimo.com/anthropic → https://api.xiaomimimo.com/anthropic/v1
    if (baseUrl && !baseUrl.endsWith('/v1')) {
      baseUrl = baseUrl.replace(/\/+$/, '') + '/v1'
    }

    return {
      apiKey,
      baseUrl,
      model: env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
    }
  } catch {
    return null
  }
}
