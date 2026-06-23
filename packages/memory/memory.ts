import { readFile, writeFile, access, mkdir, readdir, unlink } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import type { MemoryEntry, MemorySearchResult } from './schema'

const MEMORY_BASE = join(homedir(), '.licode', 'memory')

export class Memory {
  private entries: Map<string, MemoryEntry> = new Map()
  private initialized = false

  constructor(private projectPath?: string) {}

  private async ensureInit(): Promise<void> {
    if (this.initialized) return
    this.initialized = true
    await this.loadFromDir(join(MEMORY_BASE, 'global'))
    if (this.projectPath) {
      const projectId = Buffer.from(this.projectPath).toString('base64').slice(0, 16)
      await this.loadFromDir(join(MEMORY_BASE, 'projects', projectId))
    }
  }

  private async loadFromDir(dir: string): Promise<void> {
    try {
      await access(dir)
    } catch {
      return
    }

    try {
      const globalDir = join(MEMORY_BASE, 'global')
      const isGlobal = dir === globalDir
      const files = await readdir(dir)
      for (const file of files.filter(f => f.endsWith('.md'))) {
        const content = await readFile(join(dir, file), 'utf-8')
        const id = file.replace('.md', '')
        this.entries.set(id, {
          id,
          scope: isGlobal ? 'global' : 'project',
          type: 'memory',
          content,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          accessCount: 0,
        })
      }
    } catch (e) {
      process.stderr.write(`[Memory] loadFromDir failed for ${dir}: ${e}\n`)
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
    await this.persist(fullEntry)

    return id
  }

  private async persist(entry: MemoryEntry): Promise<void> {
    let dir: string

    if (entry.scope === 'global') {
      dir = join(MEMORY_BASE, 'global')
    } else if (entry.scope === 'project' && this.projectPath) {
      const projectId = Buffer.from(this.projectPath).toString('base64').slice(0, 16)
      dir = join(MEMORY_BASE, 'projects', projectId)
    } else {
      dir = join(MEMORY_BASE, 'sessions')
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
      dir = join(MEMORY_BASE, 'global')
    } else if (entry.scope === 'project' && this.projectPath) {
      const projectId = Buffer.from(this.projectPath).toString('base64').slice(0, 16)
      dir = join(MEMORY_BASE, 'projects', projectId)
    } else {
      dir = join(MEMORY_BASE, 'sessions')
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
   * 过期清理
   */
  async cleanup(maxAgeMs: number = 30 * 24 * 60 * 60 * 1000): Promise<number> {
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
