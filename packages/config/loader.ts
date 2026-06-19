import { existsSync, readFileSync, writeFileSync, mkdirSync, watch } from 'fs'
import { join, dirname } from 'path'
import { ConfigSchema, type Config } from './schema'
import { importClaudeCodeConfig } from './external'

/**
 * 配置系统 - 多层级配置、环境变量替换、热更新
 */

// 环境变量替换: ${VAR} 或 ${VAR:-default}
function replaceEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, varDef) => {
    const [varName, defaultVal] = varDef.split(':-')
    return process.env[varName] || defaultVal || ''
  })
}

// 递归替换对象中的环境变量
function replaceEnvVarsInObj(obj: any): any {
  if (typeof obj === 'string') {
    return replaceEnvVars(obj)
  }
  if (Array.isArray(obj)) {
    return obj.map(replaceEnvVarsInObj)
  }
  if (obj && typeof obj === 'object') {
    const result: any = {}
    for (const [key, value] of Object.entries(obj)) {
      result[key] = replaceEnvVarsInObj(value)
    }
    return result
  }
  return obj
}

export class ConfigLoader {
  private config: Config | null = null
  private watchers = new Map<string, () => void>()

  async load(path: string): Promise<Config> {
    if (!existsSync(path)) {
      throw new Error(`Config file not found: ${path}`)
    }
    const file = readFileSync(path, 'utf-8')
    const data = JSON.parse(file)
    // 替换环境变量
    const processedData = replaceEnvVarsInObj(data)
    return ConfigSchema.parse(processedData)
  }

  async loadWithOverrides(
    basePath: string,
    overrides?: Partial<Config>
  ): Promise<Config> {
    const base = await this.load(basePath)
    return { ...base, ...overrides }
  }

  async discoverAndLoad(home: string): Promise<Config> {
    // 优先级:
    // 1. ~/.licode/config.json (全局配置)
    // 2. ./licode.config.json (项目配置)
    // 3. Claude Code 配置 (自动导入)
    // 4. 默认配置

    const globalPath = join(home, '.licode', 'config.json')
    const localPath = join(process.cwd(), 'licode.config.json')

    // 尝试加载项目配置
    if (existsSync(localPath)) {
      try {
        this.config = await this.load(localPath)
        console.log('[✓] Loaded project config')
        return this.config
      } catch (e) {
        console.warn('[!] Failed to load project config:', e)
      }
    }

    // 尝试加载全局配置
    if (existsSync(globalPath)) {
      try {
        this.config = await this.load(globalPath)
        console.log('[✓] Loaded global config')
        return this.config
      } catch (e) {
        console.warn('[!] Failed to load global config:', e)
      }
    }

    // 尝试从 Claude Code 导入
    const claudeConfig = importClaudeCodeConfig()
    if (claudeConfig) {
      console.log('[✓] Imported LLM config from Claude Code')
      this.config = {
        llm: {
          provider: 'anthropic',
          model: claudeConfig.model,
          apiKeyEnv: 'ANTHROPIC_API_KEY',
          apiKey: claudeConfig.apiKey,
          baseUrl: claudeConfig.baseUrl,
        },
        security: { commandWhitelist: [], allowedPaths: [], deniedPaths: [] },
        memory: { path: './licode-memory.json', retentionDays: 30 },
        subagent: {
          maxConcurrent: 3,
          maxDepth: 1,
          timeoutMs: 900000,
          blockedTools: ['delegate_task', 'clarify', 'memory_write', 'send_message', 'execute_code'],
        },
      }
      return this.config
    }

    // 使用默认配置
    this.config = {
      llm: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        apiKeyEnv: 'ANTHROPIC_API_KEY',
      },
      security: { commandWhitelist: [], allowedPaths: [], deniedPaths: [] },
      memory: { path: './licode-memory.json', retentionDays: 30 },
      subagent: {
        maxConcurrent: 3,
        maxDepth: 1,
        timeoutMs: 900000,
        blockedTools: [],
      },
    }
    console.log('[!] Using default config')
    return this.config
  }

  /**
   * 保存配置
   */
  save(path: string, config: Config): void {
    const dir = dirname(path)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(path, JSON.stringify(config, null, 2), 'utf-8')
  }

  /**
   * 监听配置文件变化（热更新）
   */
  watch(path: string, onChange: (config: Config) => void): void {
    if (this.watchers.has(path)) {
      return
    }

    const watcher = watch(path, async (eventType) => {
      if (eventType === 'change') {
        try {
          const newConfig = await this.load(path)
          this.config = newConfig
          onChange(newConfig)
          console.log(`[✓] Config reloaded: ${path}`)
        } catch (e) {
          console.error(`[!] Failed to reload config: ${e}`)
        }
      }
    })

    this.watchers.set(path, () => watcher.close())
  }

  /**
   * 停止监听
   */
  unwatch(path: string): void {
    const close = this.watchers.get(path)
    if (close) {
      close()
      this.watchers.delete(path)
    }
  }

  /**
   * 获取当前配置
   */
  getConfig(): Config | null {
    return this.config
  }
}

export const configLoader = new ConfigLoader()
