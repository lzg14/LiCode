import { Database } from 'bun:sqlite'
import { existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'

export interface FTS5Result {
  id: string
  content: string
  score: number
}

export class FTS5Search {
  private db: Database
  private ready: Promise<void>

  constructor(dbPath: string) {
    const dir = dirname(dbPath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

    this.db = new Database(dbPath)
    this.db.exec('PRAGMA journal_mode=WAL')
    this.ready = this.init()
  }

  private async init(): Promise<void> {
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS fts5_index
      USING fts5(id UNINDEXED, content, tokenize='unicode61');
    `)
  }

  private awaitReady(): void {
    // sync wait for init (bun:sqlite is synchronous)
    // The init() is already sync since Database operations are sync in bun
  }

  search(query: string, limit = 10): FTS5Result[] {
    this.awaitReady()
    if (!query.trim()) return []

    try {
      const escaped = query.replace(/['"]/g, '')
      const stmt = this.db.query(`
        SELECT id, content, rank
        FROM fts5_index
        WHERE fts5_index MATCH ?
        ORDER BY rank
        LIMIT ?
      `)
      const rows = stmt.all(escaped, limit) as { id: string; content: string; rank: number }[]
      return rows.map(r => ({ id: r.id, content: r.content, score: Math.max(0, 1 - r.rank / 100) }))
    } catch {
      return this.fallbackSearch(query, limit)
    }
  }

  private fallbackSearch(query: string, limit: number): FTS5Result[] {
    const q = query.toLowerCase()
    const stmt = this.db.prepare('SELECT id, content FROM fts5_index')
    const rows = stmt.all() as { id: string; content: string }[]
    const results: FTS5Result[] = []

    for (const row of rows) {
      if (row.content.toLowerCase().includes(q)) {
        results.push({ id: row.id, content: row.content, score: 0.5 })
        if (results.length >= limit) break
      }
    }

    return results
  }

  index(id: string, content: string): void {
    this.awaitReady()
    try {
      this.db.run('DELETE FROM fts5_index WHERE id = ?', [id])
      this.db.run('INSERT INTO fts5_index (id, content) VALUES (?, ?)', [id, content])
    } catch (e) {
      console.error('FTS5 index error:', e)
    }
  }

  remove(id: string): void {
    this.awaitReady()
    this.db.run('DELETE FROM fts5_index WHERE id = ?', [id])
  }

  count(): number {
    this.awaitReady()
    const row = this.db.query('SELECT COUNT(*) as cnt FROM fts5_index').get() as { cnt: number } | undefined
    return row?.cnt ?? 0
  }

  close(): void {
    this.db.close()
  }
}
