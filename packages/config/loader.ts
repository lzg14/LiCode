import { existsSync, mkdirSync, readFileSync, watch, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DEFAULT_CONFIG } from './defaults'
import { importClaudeCodeConfig } from './external'
import { type Config, ConfigSchema, type PROVIDERS } from './schema'

/**
 * 配置系统 - 多层级配置、环境变量替换、热更新
 */

function replaceEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, varDef) => {
    const [varName, defaultVal] = varDef.split(':-')
    return process.env[varName] || defaultVal || ''
  })
}

function replaceEnvVarsInObj(obj: unknown): unknown {
  if (typeof obj === 'string') return replaceEnvVars(obj)
  if (Array.isArray(obj)) return obj.map(replaceEnvVarsInObj as (v: unknown) => unknown)
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) result[key] = replaceEnvVarsInObj(value)
    return result
  }
  return obj
}

export class ConfigLoader {
  private config: Config | null = null
  private watchers = new Map<string, () => void>()

  async load(path: string): Promise<Config> {
    if (!existsSync(path)) throw new Error(`Config file not found: ${path}`)
    return ConfigSchema.parse(replaceEnvVarsInObj(JSON.parse(readFileSync(path, 'utf-8'))))
  }

  async loadWithOverrides(basePath: string, overrides?: Partial<Config>): Promise<Config> {
    return { ...(await this.load(basePath)), ...overrides }
  }

  async discoverAndLoad(home: string): Promise<Config> {
    const globalPath = join(home, '.licode', 'config.json')
    const localPath = join(process.cwd(), 'licode.config.json')

    if (existsSync(localPath)) {
      try { this.config = await this.load(localPath); process.stderr.write('[config] Loaded project config\n') }
      catch (e) { process.stderr.write(`[config] Failed to load project config: ${e}\n`) }
    }

    if (!this.config && existsSync(globalPath)) {
      try { this.config = await this.load(globalPath); process.stderr.write('[config] Loaded global config\n') }
      catch (e) { process.stderr.write(`[config] Failed to load global config: ${e}\n`) }
    }

    if (!this.config) {
      const cc = importClaudeCodeConfig()
      if (cc) {
        const isDeepSeek = cc.baseUrl.includes('deepseek')
        const isMiniMax = cc.baseUrl.includes('minimax')
        let provider = 'anthropic'
        let baseUrl = cc.baseUrl
        if (isDeepSeek) { provider = 'deepseek'; baseUrl = 'https://api.deepseek.com' }
        if (isMiniMax) {         provider = 'minimax'; baseUrl = 'https://api.minimax.chat/v1' }
        process.stderr.write(`[config] Imported LLM config from Claude Code (${provider})\n`)
        type Provider = (typeof PROVIDERS)[number]
        this.config = {
          llm: { provider: provider as Provider, model: cc.model, apiKeyEnv: 'ANTHROPIC_AUTH_TOKEN', apiKey: cc.apiKey, baseUrl },
          security: { commandWhitelist: [], allowedPaths: [], deniedPaths: [] },
          memory: { path: '~/.licode/licode-sessions.db', retentionDays: 30 },
          subagent: { maxConcurrent: 3, maxDepth: 1, timeoutMs: 900000, blockedTools: ['delegate_task', 'clarify', 'memory_write', 'send_message', 'execute_code'] },
        }
      }
    }

    if (!this.config) {
      this.config = { ...DEFAULT_CONFIG }
      process.stderr.write('[config] Using default config\n')
    }

    if (process.env.LICODE_MODEL) this.config.llm.model = process.env.LICODE_MODEL
    if (process.env.LICODE_PROVIDER) this.config.llm.provider = process.env.LICODE_PROVIDER
    if (process.env.LICODE_API_KEY) this.config.llm.apiKey = process.env.LICODE_API_KEY

    return this.config
  }

  save(path: string, config: Config): void {
    const dir = dirname(path)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    
    // 深拷贝配置，避免修改原始对象
    const configCopy = structuredClone(config)
    
    // 递归删除所有 apiKey 字段
    const removeApiKey = (obj: unknown): void => {
      if (typeof obj !== 'object' || obj === null) return
      if (Array.isArray(obj)) {
        obj.forEach(removeApiKey)
        return
      }
      const record = obj as Record<string, unknown>
      for (const key of Object.keys(record)) {
        if (key === 'apiKey') {
          delete record[key]
        } else {
          removeApiKey(record[key])
        }
      }
    }
    
    removeApiKey(configCopy)
    writeFileSync(path, JSON.stringify(configCopy, null, 2), 'utf-8')
  }

  watch(path: string, onChange: (config: Config) => void): void {
    if (this.watchers.has(path)) return
    const watcher = watch(path, async (eventType) => {
      if (eventType === 'change') {
        try { const c = await this.load(path); this.config = c; onChange(c); process.stderr.write(`[config] Reloaded: ${path}\n`) }
        catch (e) { process.stderr.write(`[config] Failed to reload: ${e}\n`) }
      }
    })
    this.watchers.set(path, () => watcher.close())
  }

  unwatch(path: string): void { this.watchers.get(path)?.(); this.watchers.delete(path) }
  getConfig(): Config | null { return this.config }
}

export const configLoader = new ConfigLoader()
