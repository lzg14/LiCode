import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { MemoryEntry, MemorySearchResult } from './schema'

/**
 * 记忆系统 - 三层记忆架构
 * 短期：当前 session
 * 中期：项目级
 * 长期：全局
 */

const MEMORY_BASE = join(homedir(), '.licode', 'memory')

export class Memory {
  private entries: Map<string, MemoryEntry> = new Map()

  constructor(private projectPath?: string) {
    this.load()
  }

  /**
   * 加载记忆
   */
  private load(): void {
    // 加载全局记忆
    this.loadFromDir(join(MEMORY_BASE, 'global'))

    // 加载项目记忆
    if (this.projectPath) {
      const projectId = Buffer.from(this.projectPath).toString('base64').slice(0, 16)
      this.loadFromDir(join(MEMORY_BASE, 'projects', projectId))
    }
  }

  /**
   * 从目录加载记忆
   */
  private loadFromDir(dir: string): void {
    if (!existsSync(dir)) return

    try {
      const files = readdirSync(dir).filter(f => f.endsWith('.md'))
      for (const file of files) {
        const content = readFileSync(join(dir, file), 'utf-8')
        const id = file.replace('.md', '')
        this.entries.set(id, {
          id,
          scope: dir.includes('global') ? 'global' : 'project',
          type: 'memory',
          content,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          accessCount: 0,
        })
      }
    } catch {
      // ignore
    }
  }

  /**
   * 存储记忆
   */
  async store(entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt' | 'accessCount'>): Promise<string> {
    const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const fullEntry: MemoryEntry = {
      ...entry,
      id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      accessCount: 0,
    }

    this.entries.set(id, fullEntry)
    this.persist(fullEntry)

    return id
  }

  /**
   * 持久化到文件
   */
  private persist(entry: MemoryEntry): void {
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
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, `${entry.id}.md`), entry.content)
    } catch {
      // 磁盘 I/O 错误不应抛出，记忆已保存在内存中
    }
  }

  /**
   * 搜索记忆
   */
  async search(query: string, limit = 10): Promise<MemorySearchResult[]> {
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
      if (existsSync(filePath)) {
        unlinkSync(filePath)
      }
    } catch {
      // 文件删除失败不应影响内存状态
    }

    return true
  }

  /**
   * 过期清理
   */
  async cleanup(maxAgeMs: number = 30 * 24 * 60 * 60 * 1000): Promise<number> {
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
