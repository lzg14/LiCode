import type { Database } from 'bun:sqlite'
import type { SessionRow } from './helpers'
import { rowToSession, rowToMessage, rowToPart } from './helpers'
import type { Message, Part, PartType, Session, SessionSummary } from './types'

// ── Session reads ──

export function getSession(db: Database, id: string): Session | null {
  const row = db.query('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | null
  return row ? rowToSession(row) : null
}

export function listSessions(
  db: Database,
  options: {
    directory?: string
    parentId?: string
    limit?: number
    offset?: number
  } = {},
): Session[] {
  let sql = 'SELECT * FROM sessions WHERE 1=1'
  const params: any[] = []

  if (options.directory) {
    sql += ' AND directory = ?'
    params.push(options.directory)
  }

  if (options.parentId) {
    sql += ' AND parent_id = ?'
    params.push(options.parentId)
  }

  sql += ' ORDER BY updated_at DESC'

  if (options.limit) {
    sql += ' LIMIT ?'
    params.push(options.limit)
  }

  if (options.offset) {
    sql += ' OFFSET ?'
    params.push(options.offset)
  }

  const rows = db.query(sql).all(...params) as SessionRow[]
  return rows.map(row => rowToSession(row))
}

export function getLastSession(
  db: Database,
  directory?: string,
): Session | null {
  let sql = 'SELECT * FROM sessions WHERE 1=1'
  const params: any[] = []
  if (directory) {
    sql += ' AND directory = ?'
    params.push(directory)
  }
  sql += ' ORDER BY updated_at DESC LIMIT 1'
  const row = db.query(sql).get(...params) as SessionRow | null
  return row ? rowToSession(row) : null
}

// ── Session writes ──

export function insertSession(db: Database, session: Session): void {
  db.run(
    `INSERT INTO sessions (id, title, directory, parent_id, context_from, context_watermark, status, model, provider, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [session.id, session.title, session.directory, session.parentId ?? null,
     session.contextFrom ?? null, session.contextWatermark ?? null,
     session.status, session.model ?? null, session.provider ?? null,
     session.createdAt, session.updatedAt]
  )
}

export function updateSessionFields(
  db: Database,
  id: string,
  updates: Partial<Pick<Session, 'title' | 'status' | 'model' | 'provider' | 'tokenUsage' | 'cost' | 'summary' | 'lastCheckpointMessageId'>>,
): void {
  const now = Date.now()
  const sets: string[] = ['updated_at = ?']
  const params: any[] = [now]

  if (updates.title !== undefined) {
    sets.push('title = ?')
    params.push(updates.title)
  }

  if (updates.status !== undefined) {
    sets.push('status = ?')
    params.push(updates.status)
    if (updates.status === 'completed' || updates.status === 'failed') {
      sets.push('completed_at = ?')
      params.push(now)
    }
  }

  if (updates.model !== undefined) {
    sets.push('model = ?')
    params.push(updates.model)
  }

  if (updates.provider !== undefined) {
    sets.push('provider = ?')
    params.push(updates.provider)
  }

  if (updates.tokenUsage) {
    sets.push('token_input = ?', 'token_output = ?')
    params.push(updates.tokenUsage.input, updates.tokenUsage.output)
  }

  if (updates.cost !== undefined) {
    sets.push('cost = ?')
    params.push(updates.cost)
  }

  if (updates.summary) {
    sets.push('summary_additions = ?', 'summary_deletions = ?', 'summary_files = ?')
    params.push(updates.summary.additions, updates.summary.deletions,
      JSON.stringify(updates.summary.files))
  }

  if (updates.lastCheckpointMessageId !== undefined) {
    sets.push('last_checkpoint_message_id = ?')
    params.push(updates.lastCheckpointMessageId)
  }

  params.push(id)
  db.run(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`, params)
}

export function deleteSessionCascade(db: Database, id: string): void {
  db.run('DELETE FROM parts WHERE message_id IN (SELECT id FROM messages WHERE session_id = ?)', [id])
  db.run('DELETE FROM messages WHERE session_id = ?', [id])
  db.run('DELETE FROM sessions WHERE id = ?', [id])
}

/**
 * 压缩后裁剪旧消息：删除 session 中除最近 keepCount 条以外的所有消息
 */
export function trimOldMessages(db: Database, sessionId: string, keepCount: number): number {
  // 找到要保留的最早消息 ID
  const keepOldest = db.query(
    'SELECT id FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 1 OFFSET ?'
  ).get(sessionId, keepCount - 1) as { id: string } | null

  if (!keepOldest) return 0 // 消息数 <= keepCount，无需删除

  // 删除比它更早的消息及其 parts
  db.run('DELETE FROM parts WHERE message_id IN (SELECT id FROM messages WHERE session_id = ? AND created_at < ?)',
    [sessionId, (db.query('SELECT created_at FROM messages WHERE id = ?').get(keepOldest.id) as any)?.created_at])
  const result = db.run('DELETE FROM messages WHERE session_id = ? AND created_at < ?',
    [sessionId, (db.query('SELECT created_at FROM messages WHERE id = ?').get(keepOldest.id) as any)?.created_at])
  return result.changes
}

// ── Message reads ──

export function getMessages(
  db: Database,
  sessionId: string,
  options: { limit?: number; before?: number } = {},
): Message[] {
  let sql = 'SELECT * FROM messages WHERE session_id = ?'
  const params: any[] = [sessionId]

  if (options.before) {
    sql += ' AND created_at < ?'
    params.push(options.before)
  }

  sql += ' ORDER BY created_at ASC, rowid ASC'

  if (options.limit) {
    sql += ' LIMIT ?'
    params.push(options.limit)
  }

  const rows = db.query(sql).all(...params) as any[]
  return rows.map(row => rowToMessage(row))
}

export function getMessage(db: Database, id: string): Message | null {
  const row = db.query('SELECT * FROM messages WHERE id = ?').get(id) as any
  return row ? rowToMessage(row) : null
}

export function searchMessages(
  db: Database,
  sessionId: string,
  query: string,
  limit = 10,
): Message[] {
  const rows = db.query(
    `SELECT * FROM messages 
     WHERE session_id = ? AND content LIKE ? 
     ORDER BY created_at DESC LIMIT ?`
  ).all(sessionId, `%${query}%`, limit) as any[]

  return rows.map(row => rowToMessage(row))
}

export function getMessagesAsModelMessages(
  db: Database,
  sessionId: string,
  options: { limit?: number } = {},
): Array<{ role: string; content: any[] }> {
  let messages: Message[]
  if (options.limit !== undefined) {
    const rows = db.query(
      `SELECT * FROM messages WHERE session_id = ?
       ORDER BY created_at DESC, rowid DESC
       LIMIT ?`,
    ).all(sessionId, options.limit) as any[]
    messages = rows.reverse().map((row) => rowToMessage(row))
  } else {
    messages = getMessages(db, sessionId)
  }
  return messages.map(m => {
    try {
      const parsed = JSON.parse(m.content)
      if (Array.isArray(parsed)) {
        return { role: m.role, content: parsed }
      }
    } catch {
      // 不是 JSON（旧数据或纯文本），按纯文本处理
    }
    return { role: m.role, content: [{ type: 'text', text: m.content }] }
  })
}

// ── Message writes ──

export function insertMessage(db: Database, message: Message): void {
  db.run(
    `INSERT INTO messages (id, session_id, role, content, agent, model, token_input, token_output, cost, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [message.id, message.sessionId, message.role, message.content,
     message.agent ?? null, message.model ?? null,
     message.tokenUsage?.input ?? 0, message.tokenUsage?.output ?? 0,
     message.cost ?? 0, message.createdAt]
  )
}

export function touchSession(db: Database, sessionId: string, now: number): void {
  db.run('UPDATE sessions SET updated_at = ? WHERE id = ?', [now, sessionId])
}

// ── Part reads ──

export function getParts(db: Database, messageId: string): Part[] {
  const rows = db.query(
    'SELECT * FROM parts WHERE message_id = ? ORDER BY created_at ASC'
  ).all(messageId) as any[]
  return rows.map(row => rowToPart(row))
}

// ── Part writes ──

export function insertPart(db: Database, part: Part): void {
  db.run(
    `INSERT INTO parts (id, message_id, type, content, tool_name, tool_call_id, args, result, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [part.id, part.messageId, part.type, part.content,
     part.toolName ?? null, part.toolCallId ?? null,
     part.args ? JSON.stringify(part.args) : null,
     part.result ?? null,
     part.metadata ? JSON.stringify(part.metadata) : null,
     part.createdAt]
  )
}

// ── Stats ──

export function getSessionStats(
  db: Database,
  sessionId: string,
): {
  messageCount: number
  tokenUsage: { input: number; output: number; total: number }
  cost: number
  duration: number
} {
  const session = getSession(db, sessionId)
  if (!session) {
    return { messageCount: 0, tokenUsage: { input: 0, output: 0, total: 0 }, cost: 0, duration: 0 }
  }

  const stats = db.query(
    `SELECT 
      COUNT(*) as message_count,
      SUM(token_input) as token_input,
      SUM(token_output) as token_output,
      SUM(cost) as total_cost
     FROM messages WHERE session_id = ?`
  ).get(sessionId) as any

  const duration = session.completedAt
    ? session.completedAt - session.createdAt
    : Date.now() - session.createdAt

  return {
    messageCount: stats?.message_count ?? 0,
    tokenUsage: {
      input: stats?.token_input ?? 0,
      output: stats?.token_output ?? 0,
      total: (stats?.token_input ?? 0) + (stats?.token_output ?? 0),
    },
    cost: stats?.total_cost ?? 0,
    duration,
  }
}