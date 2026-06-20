import { Database } from 'bun:sqlite'
import { existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'

export type SessionStatus = 'idle' | 'running' | 'blocked' | 'completed' | 'failed'

export type PartType = 'text' | 'tool-call' | 'tool-result' | 'reasoning' | 'file'

export interface Session {
  id: string
  title: string
  directory: string
  parentId?: string
  contextFrom?: string
  contextWatermark?: string
  status: SessionStatus
  model?: string
  provider?: string
  tokenUsage?: { input: number; output: number; total: number }
  cost?: number
  summary?: { additions: number; deletions: number; files: string[] }
  lastCheckpointMessageId?: string
  createdAt: number
  updatedAt: number
  completedAt?: number
}

export interface Message {
  id: string
  sessionId: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  agent?: string
  model?: string
  tokenUsage?: { input: number; output: number; reasoning?: number }
  cost?: number
  createdAt: number
}

export interface Part {
  id: string
  messageId: string
  type: PartType
  content: string
  toolName?: string
  toolCallId?: string
  args?: Record<string, unknown>
  result?: string
  metadata?: Record<string, unknown>
  createdAt: number
}

export interface SessionSummary {
  additions: number
  deletions: number
  files: string[]
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    directory TEXT NOT NULL,
    parent_id TEXT,
    context_from TEXT,
    context_watermark TEXT,
    status TEXT DEFAULT 'idle',
    model TEXT,
    provider TEXT,
    token_input INTEGER DEFAULT 0,
    token_output INTEGER DEFAULT 0,
    cost REAL DEFAULT 0,
    summary_additions INTEGER DEFAULT 0,
    summary_deletions INTEGER DEFAULT 0,
    summary_files TEXT,
    last_checkpoint_message_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    completed_at INTEGER,
    FOREIGN KEY (parent_id) REFERENCES sessions(id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    agent TEXT,
    model TEXT,
    token_input INTEGER DEFAULT 0,
    token_output INTEGER DEFAULT 0,
    cost REAL DEFAULT 0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  );

  CREATE TABLE IF NOT EXISTS parts (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    tool_name TEXT,
    tool_call_id TEXT,
    args TEXT,
    result TEXT,
    metadata TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (message_id) REFERENCES messages(id)
  );

  CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
  CREATE INDEX IF NOT EXISTS idx_parts_message ON parts(message_id);
`

export class SessionManager {
  private db: Database

  constructor(dbPath: string) {
    const dir = dirname(dbPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    this.db = new Database(dbPath)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA foreign_keys = ON')
    this.db.exec(SCHEMA)
    this.migrate()
  }

  /**
   * Schema 迁移：检查现有表，缺失列就 ALTER TABLE 加上。
   * 用 PRAGMA table_info 检查列是否存在。
   * 新表（刚 CREATE 完）已经有全部列，迁移是 no-op。
   */
  private migrate(): void {
    const columns = (this.db.query(`PRAGMA table_info(sessions)`).all() as any[]).map(c => c.name)

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
          this.db.exec(`ALTER TABLE sessions ADD COLUMN ${col.name} ${col.type}${def}`)
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

  createSession(input: {
    title?: string
    directory: string
    parentId?: string
    contextFrom?: string
    contextWatermark?: string
    model?: string
    provider?: string
  }): Session {
    const id = `ses_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const now = Date.now()

    const session: Session = {
      id,
      title: input.title ?? `New session - ${new Date().toISOString()}`,
      directory: input.directory,
      parentId: input.parentId,
      contextFrom: input.contextFrom,
      contextWatermark: input.contextWatermark,
      status: 'idle',
      model: input.model,
      provider: input.provider,
      createdAt: now,
      updatedAt: now,
    }

    this.db.run(
      `INSERT INTO sessions (id, title, directory, parent_id, context_from, context_watermark, status, model, provider, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [session.id, session.title, session.directory, session.parentId ?? null,
       session.contextFrom ?? null, session.contextWatermark ?? null,
       session.status, session.model ?? null, session.provider ?? null,
       session.createdAt, session.updatedAt]
    )

    return session
  }

  getSession(id: string): Session | null {
    const row = this.db.query(
      'SELECT * FROM sessions WHERE id = ?'
    ).get(id) as any

    if (!row) return null

    return this.rowToSession(row)
  }

  listSessions(options: {
    directory?: string
    parentId?: string
    limit?: number
    offset?: number
  } = {}): Session[] {
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

    const rows = this.db.query(sql).all(...params) as any[]
    return rows.map(row => this.rowToSession(row))
  }

  updateSession(id: string, updates: Partial<Pick<Session, 'title' | 'status' | 'model' | 'provider' | 'tokenUsage' | 'cost' | 'summary' | 'lastCheckpointMessageId'>>): Session | null {
    const session = this.getSession(id)
    if (!session) return null

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

    this.db.run(
      `UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`,
      params
    )

    return this.getSession(id)
  }

  deleteSession(id: string): boolean {
    this.db.run(
      'DELETE FROM parts WHERE message_id IN (SELECT id FROM messages WHERE session_id = ?)',
      [id]
    )
    this.db.run('DELETE FROM messages WHERE session_id = ?', [id])
    this.db.run('DELETE FROM sessions WHERE id = ?', [id])
    return true
  }

  addMessage(input: {
    sessionId: string
    role: Message['role']
    content: string
    agent?: string
    model?: string
    tokenUsage?: Message['tokenUsage']
    cost?: number
  }): Message {
    const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const now = Date.now()

    const message: Message = {
      id,
      sessionId: input.sessionId,
      role: input.role,
      content: input.content,
      agent: input.agent,
      model: input.model,
      tokenUsage: input.tokenUsage,
      cost: input.cost,
      createdAt: now,
    }

    this.db.run(
      `INSERT INTO messages (id, session_id, role, content, agent, model, token_input, token_output, cost, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [message.id, message.sessionId, message.role, message.content,
       message.agent ?? null, message.model ?? null,
       message.tokenUsage?.input ?? 0, message.tokenUsage?.output ?? 0,
       message.cost ?? 0, message.createdAt]
    )

    this.db.run('UPDATE sessions SET updated_at = ? WHERE id = ?', [now, input.sessionId])

    return message
  }

  getMessages(sessionId: string, options: { limit?: number; before?: number } = {}): Message[] {
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

    const rows = this.db.query(sql).all(...params) as any[]

    return rows.map(row => ({
      id: row.id,
      sessionId: row.session_id,
      role: row.role,
      content: row.content,
      agent: row.agent,
      model: row.model,
      tokenUsage: row.token_input > 0 ? {
        input: row.token_input,
        output: row.token_output,
      } : undefined,
      cost: row.cost,
      createdAt: row.created_at,
    }))
  }

  getMessage(id: string): Message | null {
    const row = this.db.query('SELECT * FROM messages WHERE id = ?').get(id) as any
    if (!row) return null

    return {
      id: row.id,
      sessionId: row.session_id,
      role: row.role,
      content: row.content,
      agent: row.agent,
      model: row.model,
      tokenUsage: row.token_input > 0 ? {
        input: row.token_input,
        output: row.token_output,
      } : undefined,
      cost: row.cost,
      createdAt: row.created_at,
    }
  }

  /**
   * 获取消息，支持 contextFrom/contextWatermark 上下文继承。
   * 如果当前会话有 contextFrom，会先加载父会话的消息（截止到 contextWatermark），
   * 再加上当前会话自己的消息。
   */
  getMessagesWithContext(sessionId: string): Message[] {
    const session = this.getSession(sessionId)
    if (!session) return []

    let result: Message[] = []

    if (session.contextFrom) {
      const parentMsgs = this.getMessages(session.contextFrom)
      if (session.contextWatermark) {
        const idx = parentMsgs.findIndex(m => m.id === session.contextWatermark)
        if (idx >= 0) {
          result = parentMsgs.slice(0, idx + 1)
        } else {
          result = parentMsgs
        }
      } else {
        result = parentMsgs
      }
    }

    const ownMsgs = this.getMessages(sessionId)
    result.push(...ownMsgs)
    return result
  }

  /**
   * 把 AI SDK 格式的消息（含完整 parts）持久化到 messages + parts 表。
   * 用于 execute.ts 每次 generateText 之后调用，把完整 LLM 对话历史存下来。
   *
   * content 数组是 AI SDK ModelMessage 格式：
   *   [{ type: "text", text: "..." }]
   *   [{ type: "text", text: "..." }, { type: "tool-call", toolCallId, toolName, input }]
   *   [{ type: "tool-result", toolCallId, toolName, output: { type: "text", value: "..." } }]
   */
  appendMessageWithParts(input: {
    sessionId: string
    role: Message['role']
    content: any[]
    agent?: string
    model?: string
    tokenUsage?: Message['tokenUsage']
    cost?: number
  }): { message: Message; parts: Part[] } {
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const now = Date.now()

    // 主 message.content 用 JSON 序列化整个 parts 数组（方便 getMessages 直接拿完整）
    const contentJson = JSON.stringify(input.content)

    this.db.run(
      `INSERT INTO messages (id, session_id, role, content, agent, model, token_input, token_output, cost, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        messageId, input.sessionId, input.role, contentJson,
        input.agent ?? null, input.model ?? null,
        input.tokenUsage?.input ?? 0, input.tokenUsage?.output ?? 0,
        input.cost ?? 0, now,
      ],
    )
    this.db.run('UPDATE sessions SET updated_at = ? WHERE id = ?', [now, input.sessionId])

    // 同时把每个 part 也写到 parts 表，方便精细查询
    const createdParts: Part[] = []
    for (const c of input.content) {
      if (!c || typeof c !== 'object') continue
      const toolArgs = c.input ?? c.args
      const toolResult = c.output?.value ?? c.result ?? (typeof c.output === 'string' ? c.output : undefined)
      const part = this.addPart({
        messageId,
        type: this.inferPartType(c.type),
        content: c.text ?? JSON.stringify(toolArgs ?? c.output ?? c),
        toolName: c.toolName,
        toolCallId: c.toolCallId,
        args: toolArgs,
        result: toolResult,
        metadata: { raw: c },
      })
      createdParts.push(part)
    }

    return {
      message: {
        id: messageId,
        sessionId: input.sessionId,
        role: input.role,
        content: contentJson,
        agent: input.agent,
        model: input.model,
        tokenUsage: input.tokenUsage,
        cost: input.cost,
        createdAt: now,
      },
      parts: createdParts,
    }
  }

  /** AI SDK type → PartType 映射 */
  private inferPartType(t: string): PartType {
    switch (t) {
      case 'text': return 'text'
      case 'reasoning': return 'reasoning'
      case 'tool-call': return 'tool-call'
      case 'tool-result': return 'tool-result'
      case 'file': return 'file'
      default: return 'text'
    }
  }

  /**
   * 读取 session 的所有 messages，重建 AI SDK ModelMessage[] 格式。
   * 用作 generateText 的 messages 参数，可直接交给 LLM。
   */
  getMessagesAsModelMessages(sessionId: string): Array<{ role: string; content: any[] }> {
    const messages = this.getMessages(sessionId)
    return messages.map(m => {
      // 优先尝试 parse message.content 为 JSON（这是 appendMessageWithParts 写入的格式）
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

  addPart(input: {
    messageId: string
    type: PartType
    content: string
    toolName?: string
    toolCallId?: string
    args?: Record<string, unknown>
    result?: string
    metadata?: Record<string, unknown>
  }): Part {
    const id = `prt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const now = Date.now()

    const part: Part = {
      id,
      messageId: input.messageId,
      type: input.type,
      content: input.content,
      toolName: input.toolName,
      toolCallId: input.toolCallId,
      args: input.args,
      result: input.result,
      metadata: input.metadata,
      createdAt: now,
    }

    this.db.run(
      `INSERT INTO parts (id, message_id, type, content, tool_name, tool_call_id, args, result, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [part.id, part.messageId, part.type, part.content,
       part.toolName ?? null, part.toolCallId ?? null,
       part.args ? JSON.stringify(part.args) : null,
       part.result ?? null,
       part.metadata ? JSON.stringify(part.metadata) : null,
       part.createdAt]
    )

    return part
  }

  getParts(messageId: string): Part[] {
    const rows = this.db.query(
      'SELECT * FROM parts WHERE message_id = ? ORDER BY created_at ASC'
    ).all(messageId) as any[]

    return rows.map(row => ({
      id: row.id,
      messageId: row.message_id,
      type: row.type,
      content: row.content,
      toolName: row.tool_name,
      toolCallId: row.tool_call_id,
      args: row.args ? JSON.parse(row.args) : undefined,
      result: row.result,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: row.created_at,
    }))
  }

  getSessionStats(sessionId: string): {
    messageCount: number
    tokenUsage: { input: number; output: number; total: number }
    cost: number
    duration: number
  } {
    const session = this.getSession(sessionId)
    if (!session) {
      return { messageCount: 0, tokenUsage: { input: 0, output: 0, total: 0 }, cost: 0, duration: 0 }
    }

    const stats = this.db.query(
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

  searchMessages(sessionId: string, query: string, limit = 10): Message[] {
    const rows = this.db.query(
      `SELECT * FROM messages 
       WHERE session_id = ? AND content LIKE ? 
       ORDER BY created_at DESC LIMIT ?`
    ).all(sessionId, `%${query}%`, limit) as any[]

    return rows.map(row => ({
      id: row.id,
      sessionId: row.session_id,
      role: row.role,
      content: row.content,
      agent: row.agent,
      model: row.model,
      tokenUsage: row.token_input > 0 ? {
        input: row.token_input,
        output: row.token_output,
      } : undefined,
      cost: row.cost,
      createdAt: row.created_at,
    }))
  }

  getLastSession(directory?: string): Session | null {
    let sql = 'SELECT * FROM sessions WHERE 1=1'
    const params: any[] = []
    if (directory) {
      sql += ' AND directory = ?'
      params.push(directory)
    }
    sql += ' ORDER BY updated_at DESC LIMIT 1'
    const row = this.db.query(sql).get(...params) as any
    return row ? this.rowToSession(row) : null
  }

  close(): void {
    this.db.close()
  }

  private rowToSession(row: any): Session {
    const summaryFiles = row.summary_files ? JSON.parse(row.summary_files) : undefined
    return {
      id: row.id,
      title: row.title,
      directory: row.directory,
      parentId: row.parent_id,
      contextFrom: row.context_from,
      contextWatermark: row.context_watermark,
      status: row.status,
      model: row.model,
      provider: row.provider,
      tokenUsage: row.token_input > 0 ? {
        input: row.token_input,
        output: row.token_output,
        total: row.token_input + row.token_output,
      } : undefined,
      cost: row.cost,
      summary: (row.summary_additions || row.summary_deletions || summaryFiles) ? {
        additions: row.summary_additions ?? 0,
        deletions: row.summary_deletions ?? 0,
        files: summaryFiles ?? [],
      } : undefined,
      lastCheckpointMessageId: row.last_checkpoint_message_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
    }
  }
}
