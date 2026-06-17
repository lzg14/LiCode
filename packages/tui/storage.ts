import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'

export class Storage {
  private path: string
  private cache = new Map<string, unknown>()

  constructor(path: string) {
    this.path = join(process.env.HOME ?? '.', '.licode', path)
    this.load()
  }

  private load(): void {
    try {
      if (existsSync(this.path)) {
        const data = JSON.parse(readFileSync(this.path, 'utf-8'))
        Object.entries(data).forEach(([k, v]) => this.cache.set(k, v))
      }
    } catch {
      // ignore
    }
  }

  get<T>(key: string, defaultValue?: T): T | undefined {
    return (this.cache.get(key) as T) ?? defaultValue
  }

  set(key: string, value: unknown): void {
    this.cache.set(key, value)
    this.persist()
  }

  delete(key: string): void {
    this.cache.delete(key)
    this.persist()
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      const data = Object.fromEntries(this.cache)
      writeFileSync(this.path, JSON.stringify(data, null, 2))
    } catch {
      // ignore
    }
  }
}

export const storage = new Storage('tui.json')
