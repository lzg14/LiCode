import type { MemoryEntry, MemorySearchResult } from './schema'
import { FTS5Search } from './fts5'

export class Memory {
  private fts: FTS5Search

  constructor(dbPath: string) {
    this.fts = new FTS5Search(dbPath)
  }

  async store(entry: MemoryEntry): Promise<void> {
    this.fts.index(entry.id, entry.content)
  }

  async search(query: string, limit = 10): Promise<MemorySearchResult[]> {
    return this.fts.search(query, limit)
  }

  async recall(query: string): Promise<string[]> {
    const results = await this.search(query)
    return results.map(r => r.content)
  }

  close(): void {
    this.fts.close()
  }
}
