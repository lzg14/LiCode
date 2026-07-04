import { readFile, writeFile, access, mkdir, readdir, unlink, stat } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import type { MemoryEntry, MemorySearchResult } from './schema'

const DEFAULT_MEMORY_BASE = join(homedir(), '.licode', 'memory')
const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const DEFAULT_HARD_CAP = 1000

export interface MemoryConfig {
  /** 记忆存储根目录；默认 ~/.licode/memory */
  baseDir?: string
  /** 加载时跳过超过此 mtime 的文件；默认 30 天 */
  maxAgeMs?: number
  /** 内存中 entry 数量上限，超过按 updatedAt 淘汰最旧；默认 1000 */
  hardCap?: number
}

export class Memory {
  private entries: Map<string, MemoryEntry> = new Map()
  private initialized = false
  private baseDir: string
  private maxAgeMs: number
  private hardCap: number

  constructor(private projectPath?: string, config: MemoryConfig = {}) {
    this.baseDir = config.baseDir ?? DEFAULT_MEMORY_BASE
    this.maxAgeMs = config.maxAgeMs ?? DEFAULT_MAX_AGE_MS
    this.hardCap = config.hardCap ?? DEFAULT_HARD_CAP
  }

  private async ensureInit(): Promise<void> {
    if (this.initialized) return
    this.initialized = true
    await this.loadFromDir(join(this.baseDir, 'global'))
    if (this.projectPath) {
      const projectId = Buffer.from(this.projectPath).toString('base64').slice(0, 16)
      await this.loadFromDir(join(this.baseDir, 'projects', projectId))
    }
    // 加载后立即按 hardCap 裁剪，防止磁盘上有大量历史 entry 时一次性吃光内存
    this.enforceHardCap()
  }

  private async loadFromDir(dir: string): Promise<void> {
    try {
      await access(dir)
    } catch {
      return
    }

    try {
      const globalDir = join(this.baseDir, 'global')
      const isGlobal = dir === globalDir
      const files = await readdir(dir)
      const now = Date.now()
      for (const file of files.filter(f => f.endsWith('.md'))) {
        const fullPath = join(dir, file)
        // 用文件 mtime 作为 updatedAt，确保 maxAgeMs 过滤对磁盘文件有效
        let mtimeMs = now
        try {
          const s = await stat(fullPath)
          mtimeMs = s.mtimeMs
        } catch {
          // stat 失败就当最新，跳过
          mtimeMs = now
        }
        // 过期文件不入内存（保留在磁盘，由 cleanup() 显式删除）
        if (now - mtimeMs > this.maxAgeMs) continue

        const content = await readFile(fullPath, 'utf-8')
        const id = file.replace('.md', '')
        this.entries.set(id, {
          id,
          scope: isGlobal ? 'global' : 'project',
          type: 'memory',
          content,
          createdAt: mtimeMs,
          updatedAt: mtimeMs,
          accessCount: 0,
        })
      }
    } catch (e) {
      process.stderr.write(`[Memory] loadFromDir failed for ${dir}: ${e}\n`)
    }
  }

  /**
   * 强制把 entries 数量限制在 hardCap 以内：按 updatedAt 升序淘汰最旧的。
   * 注意：只清理内存层；磁盘文件由显式 cleanup() 删除。
   */
  private enforceHardCap(): void {
    if (this.entries.size <= this.hardCap) return
    const sorted = Array.from(this.entries.values()).sort((a, b) => a.updatedAt - b.updatedAt)
    const toDrop = sorted.slice(0, this.entries.size - this.hardCap)
    for (const entry of toDrop) {
      this.entries.delete(entry.id)
    }
  }

  /**
   * 存储记忆
   */
  async store(entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt' | 'accessCount'>): Promise<string> {
    await this.ensureInit()
    const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const fullEntry: MemoryEntry = {
      ...entry,
      id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      accessCount: 0,
    }

    this.entries.set(id, fullEntry)
    // store 后立即裁剪，防止长期运行进程内 map 单调增长
    this.enforceHardCap()
    await this.persist(fullEntry)

    return id
  }

  private async persist(entry: MemoryEntry): Promise<void> {
    let dir: string

    if (entry.scope === 'global') {
      dir = join(this.baseDir, 'global')
    } else if (entry.scope === 'project' && this.projectPath) {
      const projectId = Buffer.from(this.projectPath).toString('base64').slice(0, 16)
      dir = join(this.baseDir, 'projects', projectId)
    } else {
      dir = join(this.baseDir, 'sessions')
    }

    try {
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, `${entry.id}.md`), entry.content)
    } catch (e) {
      console.warn(`[Memory] persist failed:`, e)
    }
  }

  /**
   * 搜索记忆
   */
  async search(query: string, limit = 10): Promise<MemorySearchResult[]> {
    await this.ensureInit()
    const results: MemorySearchResult[] = []
    const q = query.toLowerCase()

    for (const [id, entry] of this.entries.entries()) {
      const content = entry.content.toLowerCase()
      let score = 0

      // 简单的 BM25-like 评分
      if (content.includes(q)) score += 10
      if (content.startsWith(q)) score += 5
      if (entry.accessCount > 0) score += entry.accessCount

      if (score > 0) {
        results.push({ id, content: entry.content, score })
      }
    }

    // 按分数排序
    results.sort((a, b) => b.score - a.score)

    return results.slice(0, limit)
  }

  /**
   * 回忆记忆
   */
  async recall(query: string): Promise<string[]> {
    const results = await this.search(query)
    return results.map(r => r.content)
  }

  /**
   * 获取所有记忆
   */
  list(scope?: 'global' | 'project' | 'session'): MemoryEntry[] {
    return Array.from(this.entries.values())
      .filter(e => !scope || e.scope === scope)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  /**
   * 删除记忆
   */
  async delete(id: string): Promise<boolean> {
    await this.ensureInit()
    const entry = this.entries.get(id)
    if (!entry) return false

    this.entries.delete(id)

    // 同时删除持久化文件
    let dir: string
    if (entry.scope === 'global') {
      dir = join(this.baseDir, 'global')
    } else if (entry.scope === 'project' && this.projectPath) {
      const projectId = Buffer.from(this.projectPath).toString('base64').slice(0, 16)
      dir = join(this.baseDir, 'projects', projectId)
    } else {
      dir = join(this.baseDir, 'sessions')
    }

    const filePath = join(dir, `${id}.md`)
    try {
      await unlink(filePath)
    } catch {
      // 文件删除失败不应影响内存状态
    }

    return true
  }

  /**
   * 过期清理：删除内存和磁盘上都过期的 entry。
   * 默认 maxAgeMs = 30 天。
   */
  async cleanup(maxAgeMs: number = this.maxAgeMs): Promise<number> {
    await this.ensureInit()
    const now = Date.now()
    let count = 0
    const expiredIds: string[] = []

    for (const [id, entry] of this.entries.entries()) {
      if (now - entry.updatedAt > maxAgeMs) {
        expiredIds.push(id)
        count++
      }
    }

    for (const id of expiredIds) {
      await this.delete(id)
    }

    return count
  }
}