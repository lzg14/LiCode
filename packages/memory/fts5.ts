import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'

export class FTS5Search {
  private indexPath: string
  private documents: Map<string, string> = new Map()

  constructor(private dbPath: string) {
    this.indexPath = dbPath.replace('.db', '.index.json')
    this.load()
  }

  private load(): void {
    try {
      if (existsSync(this.indexPath)) {
        const data = JSON.parse(readFileSync(this.indexPath, 'utf-8'))
        this.documents = new Map(data)
      }
    } catch {
      // ignore
    }
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.indexPath), { recursive: true })
      writeFileSync(this.indexPath, JSON.stringify([...this.documents.entries()]))
    } catch {
      // ignore
    }
  }

  search(query: string, limit = 10): { id: string; content: string; score: number }[] {
    const results: { id: string; content: string; score: number }[] = []
    const q = query.toLowerCase()

    for (const [id, content] of this.documents.entries()) {
      if (content.toLowerCase().includes(q)) {
        results.push({ id, content, score: 1 })
      }
      if (results.length >= limit) break
    }

    return results
  }

  index(id: string, content: string): void {
    this.documents.set(id, content)
    this.persist()
  }
}
