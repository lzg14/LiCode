import Database from 'better-sqlite3'

export class FTS5Search {
  private db: Database.Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.init()
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        access_count INTEGER DEFAULT 0
      )
    `)

    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        content,
        content='memory',
        content_rowid='rowid'
      )
    `)
  }

  search(query: string, limit = 10): MemorySearchResult[] {
    const stmt = this.db.prepare(`
      SELECT m.id, m.content, bm25(memory_fts) as score
      FROM memory_fts
      JOIN memory m ON m.rowid = memory_fts.rowid
      WHERE memory_fts MATCH ?
      ORDER BY score
      LIMIT ?
    `)
    return stmt.all(query, limit) as MemorySearchResult[]
  }

  index(id: string, content: string): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO memory_fts(rowid, content)
      SELECT rowid, content FROM memory WHERE id = ?
    `)
    stmt.run(id)
  }

  close(): void {
    this.db.close()
  }
}
