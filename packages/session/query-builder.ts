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
 * 估算 token 数量（char/4 启发式）
 */
export function estimateTokens(text: string): number {
  // 简单启发式：1 token ≈ 4 字符（英文）或 2 字符（中文）
  // 这里用保守估计：4 字符/token
  return Math.ceil(text.length / 4)
}

/**
 * 标记旧消息为 archived（不删除，只置位）
 * 与 trimOldMessages 的区别：不删除数据，只在投影时跳过
 */
export function archiveOldMessages(db: Database, sessionId: string, keepCount: number): number {
  // 找到要保留的最早消息 ID
  const keepOldest = db.query(
    'SELECT id FROM messages WHERE session_id = ? AND archived = 0 ORDER BY created_at DESC LIMIT 1 OFFSET ?'
  ).get(sessionId, keepCount - 1) as { id: string } | null

  if (!keepOldest) return 0 // 消息数 <= keepCount，无需归档

  // 获取该消息的 created_at
  const oldestMsg = db.query('SELECT created_at FROM messages WHERE id = ?').get(keepOldest.id) as any
  if (!oldestMsg) return 0

  // 标记比它更早的未归档消息为 archived
  const result = db.run(
    'UPDATE messages SET archived = 1 WHERE session_id = ? AND created_at < ? AND archived = 0',
    [sessionId, oldestMsg.created_at]
  )
  return result.changes
}

/**
 * 基于 token 预算归档旧消息
 * 当会话 token 总量超过 maxTokens 时，归档较旧的消息
 */
export function archiveByTokenBudget(
  db: Database,
  sessionId: string,
  maxTokens: number,
  keepRecent: number = 10,
): number {
  // 获取所有未归档消息的 token 估算
  const messages = db.query(
    'SELECT id, content, created_at FROM messages WHERE session_id = ? AND archived = 0 ORDER BY created_at ASC'
  ).all(sessionId) as Array<{ id: string; content: string; created_at: number }>

  // 计算总 token
  let totalTokens = 0
  for (const msg of messages) {
    totalTokens += estimateTokens(msg.content)
  }

  // 如果未超预算，无需归档
  if (totalTokens <= maxTokens) return 0

  // 从最旧的消息开始归档，但保留最近 keepRecent 条
  let archivedCount = 0
  const tokensToFree = totalTokens - maxTokens
  let freedTokens = 0

  for (const msg of messages) {
    // 保留最近 keepRecent 条
    if (archivedCount >= messages.length - keepRecent) break
    // 已释放足够 token
    if (freedTokens >= tokensToFree) break

    const msgTokens = estimateTokens(msg.content)
    db.run('UPDATE messages SET archived = 1 WHERE id = ?', [msg.id])
    freedTokens += msgTokens
    archivedCount++
  }

  return archivedCount
}

/**
 * 压缩后裁剪旧消息：删除 session 中除最近 keepCount 条以外的所有消息
 * @deprecated 请使用 archiveOldMessages 代替
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
  options: { limit?: number; includeArchived?: boolean } = {},
): Array<{ role: string; content: any[] }> {
  let messages: Message[]
  
  // 默认跳过 archived 消息（压缩投影）
  const archivedFilter = options.includeArchived ? '' : 'AND archived = 0'
  
  if (options.limit !== undefined) {
    const rows = db.query(
      `SELECT * FROM messages WHERE session_id = ? ${archivedFilter}
       ORDER BY created_at DESC, rowid DESC
       LIMIT ?`,
    ).all(sessionId, options.limit) as any[]
    messages = rows.reverse().map((row) => rowToMessage(row))
  } else {
    const rows = db.query(
      `SELECT * FROM messages WHERE session_id = ? ${archivedFilter}
       ORDER BY created_at ASC, rowid ASC`
    ).all(sessionId) as any[]
    messages = rows.map((row) => rowToMessage(row))
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
    `INSERT INTO messages (id, session_id, role, content, agent, model, token_input, token_output, cost, parent_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [message.id, message.sessionId, message.role, message.content,
     message.agent ?? null, message.model ?? null,
     message.tokenUsage?.input ?? 0, message.tokenUsage?.output ?? 0,
     message.cost ?? 0, message.parentId ?? null, message.createdAt]
  )
}

// ── Message Branching ──

/**
 * 获取消息的子消息
 */
export function getChildMessages(db: Database, parentId: string): Message[] {
  const rows = db.query(
    'SELECT * FROM messages WHERE parent_id = ? ORDER BY created_at ASC'
  ).all(parentId) as any[]
  return rows.map(row => rowToMessage(row))
}

/**
 * 获取消息的完整分支（从根到叶）
 */
export function getMessageBranch(db: Database, messageId: string): Message[] {
  const branch: Message[] = []
  let currentId: string | undefined = messageId
  
  while (currentId) {
    const row = db.query('SELECT * FROM messages WHERE id = ?').get(currentId) as any
    if (!row) break
    branch.unshift(rowToMessage(row))
    currentId = row.parent_id
  }
  
  return branch
}

/**
 * 获取会话的消息树（所有分支）
 */
export function getMessageTree(db: Database, sessionId: string): MessageTreeNode[] {
  // 获取所有消息
  const allMessages = db.query(
    'SELECT * FROM messages WHERE session_id = ? AND archived = 0 ORDER BY created_at ASC'
  ).all(sessionId) as any[]
  
  const messages = allMessages.map(row => rowToMessage(row))
  const messageMap = new Map(messages.map(m => [m.id, m]))
  
  // 构建树
  const roots: MessageTreeNode[] = []
  const childrenMap = new Map<string, MessageTreeNode[]>()
  
  for (const msg of messages) {
    const node: MessageTreeNode = { message: msg, children: [] }
    
    if (msg.parentId && messageMap.has(msg.parentId)) {
      // 有父节点，添加到父节点的 children
      const children = childrenMap.get(msg.parentId) || []
      children.push(node)
      childrenMap.set(msg.parentId, children)
    } else {
      // 根节点
      roots.push(node)
    }
    
    childrenMap.set(msg.id, node.children)
  }
  
  // 填充 children
  for (const [parentId, children] of childrenMap) {
    const parentNode = roots.find(r => r.message.id === parentId) || 
                       findNodeInTree(roots, parentId)
    if (parentNode) {
      parentNode.children = children
    }
  }
  
  return roots
}

/**
 * 在树中查找节点
 */
function findNodeInTree(nodes: MessageTreeNode[], id: string): MessageTreeNode | null {
  for (const node of nodes) {
    if (node.message.id === id) return node
    const found = findNodeInTree(node.children, id)
    if (found) return found
  }
  return null
}

/**
 * 获取指定分支的消息（从根到指定叶节点）
 */
export function getBranchMessages(
  db: Database,
  sessionId: string,
  leafMessageId?: string,
): Message[] {
  if (!leafMessageId) {
    // 没有指定叶节点，返回线性历史（按时间排序）
    return db.query(
      'SELECT * FROM messages WHERE session_id = ? AND archived = 0 AND parent_id IS NULL ORDER BY created_at ASC'
    ).all(sessionId as any).map(row => rowToMessage(row as Record<string, unknown>))
  }
  
  // 返回从根到指定叶节点的路径
  return getMessageBranch(db, leafMessageId)
}

/**
 * 更新消息的 parent_id（用于分支/回退）
 */
export function updateMessageParent(
  db: Database,
  messageId: string,
  newParentId: string | null,
): void {
  db.run('UPDATE messages SET parent_id = ? WHERE id = ?', [newParentId, messageId])
}

/**
 * 消息树节点
 */
export interface MessageTreeNode {
  message: Message
  children: MessageTreeNode[]
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