import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { ConfigSchema, type Config } from './schema'

export class ConfigLoader {
  private config: Config | null = null

  async load(path: string): Promise<Config> {
    if (!existsSync(path)) {
      throw new Error(`Config file not found: ${path}`)
    }
    const file = readFileSync(path, 'utf-8')
    const data = JSON.parse(file)
    return ConfigSchema.parse(data)
  }

  async loadWithOverrides(
    basePath: string,
    overrides?: Partial<Config>
  ): Promise<Config> {
    const base = await this.load(basePath)
    return { ...base, ...overrides }
  }

  async discoverAndLoad(home: string): Promise<Config> {
    // 优先级: ~/.licode/config.json > ./licode.config.json
    const globalPath = join(home, '.licode', 'config.json')
    const localPath = join(process.cwd(), 'licode.config.json')

    if (existsSync(localPath)) {
      return this.load(localPath)
    }
    if (existsSync(globalPath)) {
      return this.load(globalPath)
    }

    throw new Error('No config file found')
  }
}

export const configLoader = new ConfigLoader()
