import { existsSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'

export interface ExternalSource {
  type: 'claude-code' | 'opencode' | 'hermes'
  path: string
  exists: boolean
}

export function discoverExternalSources(home: string): ExternalSource[] {
  return [
    {
      type: 'claude-code',
      path: join(home, '.claude', 'settings.json'),
      exists: existsSync(join(home, '.claude', 'settings.json')),
    },
    {
      type: 'opencode',
      path: join(home, '.opencode'),
      exists: existsSync(join(home, '.opencode')),
    },
    {
      type: 'hermes',
      path: join(home, '.hermes'),
      exists: existsSync(join(home, '.hermes')),
    },
  ]
}

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
