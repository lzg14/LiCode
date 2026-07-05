import type { Database } from 'bun:sqlite'

export function migrate(db: Database): void {
  const columns = (db.query(`PRAGMA table_info(sessions)`).all() as any[]).map(c => c.name)

  const expected: Array<{ name: string; type: string; default?: string }> = [
    { name: 'context_from', type: 'TEXT' },
    { name: 'context_watermark', type: 'TEXT' },
    { name: 'summary_additions', type: 'INTEGER', default: '0' },
    { name: 'summary_deletions', type: 'INTEGER', default: '0' },
    { name: 'summary_files', type: 'TEXT' },
    { name: 'last_checkpoint_message_id', type: 'TEXT' },
  ]

  for (const col of expected) {
    if (!columns.includes(col.name)) {
      const def = col.default !== undefined ? ` DEFAULT ${col.default}` : ''
      try {
        db.exec(`ALTER TABLE sessions ADD COLUMN ${col.name} ${col.type}${def}`)
      } catch (e) {
        // 如果列已存在（race condition），忽略
        const msg = e instanceof Error ? e.message : String(e)
        if (!msg.includes('duplicate column')) {
          throw e
        }
      }
    }
  }
}