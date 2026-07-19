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

    return {
      apiKey,
      baseUrl: env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
      model: env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
    }
  } catch {
    return null
  }
}
