import { readdir, readFile, stat } from 'fs/promises'
import { join, extname, relative } from 'path'
import { BaseIntegration, type HealthStatus } from './types'

/**
 * 笔记集成 - 通用 Markdown 文件读取和搜索
 */

export interface Note {
  path: string
  title: string
  content: string
  lastModified: Date
}

export interface SearchOptions {
  query: string
  caseSensitive?: boolean
  limit?: number
}

export interface NotesConfig {
  vaultPath: string
  extensions?: string[]
  excludePatterns?: string[]
}

export class NotesIntegration extends BaseIntegration {
  name = 'notes'
  protected config: NotesConfig
  private supportedExtensions: string[]

  constructor(config: NotesConfig) {
    super()
    this.config = config
    this.supportedExtensions = config.extensions ?? ['.md', '.markdown', '.txt']
  }

  async connect(): Promise<void> {
    try {
      await stat(this.config.vaultPath)
      this.enabled = true
    } catch {
      this.enabled = false
      throw new Error(`Vault path not found: ${this.config.vaultPath}`)
    }
  }

  async disconnect(): Promise<void> {
    this.enabled = false
  }

  async health(): Promise<HealthStatus> {
    try {
      await stat(this.config.vaultPath)
      return { healthy: true, message: 'Vault accessible' }
    } catch {
      return { healthy: false, message: 'Vault not accessible' }
    }
  }

  /**
   * 读取单个笔记
   */
  async readNote(notePath: string): Promise<Note> {
    return this.withConnection(async () => {
      const fullPath = join(this.config.vaultPath, notePath)
      const content = await readFile(fullPath, 'utf-8')
      const stats = await stat(fullPath)
      const title = this.extractTitle(notePath, content)

      return {
        path: notePath,
        title,
        content,
        lastModified: stats.mtime
      }
    })
  }

  /**
   * 列出所有笔记
   */
  async listNotes(subDir = ''): Promise<Note[]> {
    return this.withConnection(async () => {
      const dirPath = join(this.config.vaultPath, subDir)
      const entries = await readdir(dirPath, { withFileTypes: true })
      const notes: Note[] = []

      for (const entry of entries) {
        if (entry.name.startsWith('.') && entry.name !== '.') {
          continue
        }

        const entryPath = join(subDir, entry.name)
        const fullPath = join(this.config.vaultPath, entryPath)

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
   * 搜索笔记
   */
  async searchNotes(options: SearchOptions): Promise<Note[]> {
    return this.withConnection(async () => {
      const allNotes = await this.listNotes()
      const query = options.caseSensitive ? options.query : options.query.toLowerCase()
      const limit = options.limit ?? 50

      const results: Note[] = []

      for (const note of allNotes) {
        const searchContent = options.caseSensitive ? note.content : note.content.toLowerCase()
        const searchTitle = options.caseSensitive ? note.title : note.title.toLowerCase()

        if (searchContent.includes(query) || searchTitle.includes(query)) {
          results.push(note)
          if (results.length >= limit) break
        }
      }

      return results
    })
  }

  /**
   * 按标签搜索（解析 Markdown 标签）
   */
  async searchByTag(tag: string): Promise<Note[]> {
    return this.withConnection(async () => {
      const allNotes = await this.listNotes()
      const tagPattern = new RegExp(`(?:^|\\s)#${tag}(?:\\s|$|,)`, 'i')

      return allNotes.filter(note => tagPattern.test(note.content))
    })
  }

  /**
   * 获取文件夹结构
   */
  async getFolderStructure(subDir = ''): Promise<string[]> {
    return this.withConnection(async () => {
      const dirPath = join(this.config.vaultPath, subDir)
      const entries = await readdir(dirPath, { withFileTypes: true })
      const structure: string[] = []

      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue

        const entryPath = join(subDir, entry.name)

        if (entry.isDirectory()) {
          structure.push(`${entryPath}/`)
          const subStructure = await this.getFolderStructure(entryPath)
          structure.push(...subStructure.map(s => `  ${s}`))
        } else if (this.isSupportedFile(entry.name)) {
          structure.push(entryPath)
        }
      }

      return structure
    })
  }

  /**
   * 检查文件是否为支持的格式
   */
  protected isSupportedFile(filename: string): boolean {
    const ext = extname(filename).toLowerCase()
    return this.supportedExtensions.includes(ext)
  }

  /**
   * 从文件路径或内容提取标题
   */
  protected extractTitle(filePath: string, content: string): string {
    // 尝试从内容中提取 # 标题
    const headingMatch = content.match(/^#\s+(.+)$/m)
    if (headingMatch) {
      return headingMatch[1].trim()
    }

    // 使用文件名作为标题
    const filename = filePath.split(/[/\\]/).pop() ?? filePath
    return filename.replace(/\.[^.]+$/, '')
  }
}
