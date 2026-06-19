import { readdir, readFile, stat } from 'fs/promises'
import { join, extname, basename } from 'path'
import { NotesIntegration, type Note, type SearchOptions, type NotesConfig } from './notes'
import type { HealthStatus } from './types'

/**
 * Obsidian 集成 - 本地文件系统 API
 * Obsidian 使用 Markdown 文件，vault 目录下有 .obsidian 配置
 */

export interface ObsidianConfig extends NotesConfig {
  vaultPath: string
  attachPath?: string
  dailyNotes?: boolean
  dailyNotesFormat?: string
}

export interface ObsidianLink {
  type: 'wiki' | 'embed' | 'tag'
  target: string
  raw: string
}

export interface ObsidianFrontmatter {
  title?: string
  tags?: string[]
  aliases?: string[]
  created?: string
  modified?: string
  [key: string]: unknown
}

export interface ObsidianNote extends Note {
  frontmatter?: ObsidianFrontmatter
  links: ObsidianLink[]
  tags: string[]
}

export class ObsidianIntegration extends NotesIntegration {
  name = 'obsidian'
  private obsidianConfig: ObsidianConfig

  constructor(config: ObsidianConfig) {
    super(config)
    this.obsidianConfig = config
  }

  async connect(): Promise<void> {
    await super.connect()

    // 验证是否为 Obsidian vault
    const obsidianPath = join(this.config.vaultPath, '.obsidian')
    try {
      await stat(obsidianPath)
    } catch {
      throw new Error(`Not an Obsidian vault: ${this.config.vaultPath}`)
    }
  }

  async health(): Promise<HealthStatus> {
    const baseHealth = await super.health()
    if (!baseHealth.healthy) return baseHealth

    const obsidianPath = join(this.config.vaultPath, '.obsidian')
    try {
      await stat(obsidianPath)
      return { healthy: true, message: 'Obsidian vault detected' }
    } catch {
      return { healthy: false, message: '.obsidian directory not found' }
    }
  }

  /**
   * 读取笔记（包含 frontmatter 和链接解析）
   */
  async readNote(notePath: string): Promise<ObsidianNote> {
    return this.withConnection(async () => {
      const fullPath = join(this.config.vaultPath, notePath)
      const content = await readFile(fullPath, 'utf-8')
      const stats = await stat(fullPath)

      const { frontmatter, body } = this.parseFrontmatter(content)
      const links = this.parseLinks(body)
      const tags = this.extractTags(body, frontmatter)
      const title = frontmatter?.title ?? this.extractTitle(notePath, content)

      return {
        path: notePath,
        title,
        content,
        lastModified: stats.mtime,
        frontmatter,
        links,
        tags
      }
    })
  }

  /**
   * 列出所有笔记
   */
  async listNotes(subDir = ''): Promise<ObsidianNote[]> {
    return this.withConnection(async () => {
      const dirPath = join(this.config.vaultPath, subDir)
      const entries = await readdir(dirPath, { withFileTypes: true })
      const notes: ObsidianNote[] = []

      for (const entry of entries) {
        if (entry.name.startsWith('.') && entry.name !== '.') {
          continue
        }

        const entryPath = join(subDir, entry.name)

        if (entry.isDirectory()) {
          const subNotes = await this.listNotes(entryPath)
          notes.push(...subNotes)
        } else if (this.isSupportedFile(entry.name)) {
          try {
            const note = await this.readNote(entryPath)
            notes.push(note)
          } catch {
            // Skip unreadable files
          }
        }
      }

      return notes
    })
  }

  /**
   * 搜索笔记（支持内容和 frontmatter 搜索）
   */
  async searchNotes(options: SearchOptions): Promise<ObsidianNote[]> {
    return this.withConnection(async () => {
      const allNotes = await this.listNotes()
      const query = options.caseSensitive ? options.query : options.query.toLowerCase()
      const limit = options.limit ?? 50

      const results: ObsidianNote[] = []

      for (const note of allNotes) {
        const searchContent = options.caseSensitive ? note.content : note.content.toLowerCase()
        const searchTitle = options.caseSensitive ? note.title : note.title.toLowerCase()

        // 搜索内容和标题
        if (searchContent.includes(query) || searchTitle.includes(query)) {
          results.push(note)
          if (results.length >= limit) break
          continue
        }

        // 搜索 frontmatter
        if (note.frontmatter) {
          const frontmatterStr = JSON.stringify(note.frontmatter).toLowerCase()
          if (frontmatterStr.includes(query)) {
            results.push(note)
            if (results.length >= limit) break
          }
        }
      }

      return results
    })
  }

  /**
   * 按标签搜索
   */
  async searchByTag(tag: string): Promise<ObsidianNote[]> {
    return this.withConnection(async () => {
      const allNotes = await this.listNotes()
      const normalizedTag = tag.startsWith('#') ? tag.slice(1) : tag

      return allNotes.filter(note =>
        note.tags.some(t => t.toLowerCase() === normalizedTag.toLowerCase())
      )
    })
  }

  /**
   * 获取链接到指定笔记的所有笔记
   */
  async getBacklinks(notePath: string): Promise<ObsidianNote[]> {
    return this.withConnection(async () => {
      const allNotes = await this.listNotes()
      const noteName = basename(notePath, extname(notePath))

      return allNotes.filter(note =>
        note.links.some(link => link.target === noteName)
      )
    })
  }

  /**
   * 解析 Wiki 链接和嵌入
   */
  private parseLinks(content: string): ObsidianLink[] {
    const links: ObsidianLink[] = []

    // Wiki 链接: [[target]] or [[target|alias]]
    const wikiLinkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g
    let match

    while ((match = wikiLinkRegex.exec(content)) !== null) {
      links.push({
        type: 'wiki',
        target: match[1].trim(),
        raw: match[0]
      })
    }

    // 嵌入: ![[target]]
    const embedRegex = /!\[\[([^\]]+)\]\]/g
    while ((match = embedRegex.exec(content)) !== null) {
      links.push({
        type: 'embed',
        target: match[1].trim(),
        raw: match[0]
      })
    }

    // 标签: #tag
    const tagRegex = /(?:^|\s)#([a-zA-Z0-9_/-]+)/g
    while ((match = tagRegex.exec(content)) !== null) {
      links.push({
        type: 'tag',
        target: match[1],
        raw: match[0]
      })
    }

    return links
  }

  /**
   * 提取所有标签
   */
  private extractTags(content: string, frontmatter?: ObsidianFrontmatter): string[] {
    const tags = new Set<string>()

    // 从 frontmatter 提取
    if (frontmatter?.tags) {
      frontmatter.tags.forEach(tag => tags.add(tag))
    }

    // 从内容提取
    const tagRegex = /(?:^|\s)#([a-zA-Z0-9_/-]+)/g
    let match
    while ((match = tagRegex.exec(content)) !== null) {
      tags.add(match[1])
    }

    return Array.from(tags)
  }

  /**
   * 解析 YAML frontmatter
   */
  private parseFrontmatter(content: string): { frontmatter?: ObsidianFrontmatter; body: string } {
    const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/
    const match = content.match(frontmatterRegex)

    if (!match) {
      return { body: content }
    }

    const frontmatterStr = match[1]
    const body = match[2]

    try {
      const frontmatter: ObsidianFrontmatter = {}
      const lines = frontmatterStr.split('\n')

      for (const line of lines) {
        const colonIndex = line.indexOf(':')
        if (colonIndex === -1) continue

        const key = line.slice(0, colonIndex).trim()
        const value = line.slice(colonIndex + 1).trim()

        // 简单 YAML 解析
        if (value.startsWith('[') && value.endsWith(']')) {
          // 数组
          const arrayStr = value.slice(1, -1)
          frontmatter[key] = arrayStr.split(',').map(v => v.trim().replace(/^["']|["']$/g, ''))
        } else if (value === 'true') {
          frontmatter[key] = true
        } else if (value === 'false') {
          frontmatter[key] = false
        } else {
          frontmatter[key] = value.replace(/^["']|["']$/g, '')
        }
      }

      return { frontmatter, body }
    } catch {
      return { body }
    }
  }

  /**
   * 检查文件是否为支持的格式（默认只支持 Markdown）
   */
  protected isSupportedFile(filename: string): boolean {
    const ext = extname(filename).toLowerCase()
    return ext === '.md' || ext === '.markdown'
  }

  /**
   * 获取每日笔记路径
   */
  getDailyNotePath(date: Date = new Date()): string {
    const format = this.obsidianConfig.dailyNotesFormat ?? 'YYYY-MM-DD'
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')

    const filename = format
      .replace('YYYY', String(year))
      .replace('MM', month)
      .replace('DD', day)

    return `${filename}.md`
  }
}
