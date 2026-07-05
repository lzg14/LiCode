import { Database } from 'bun:sqlite'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { SCHEMA } from './schema'
import type { Message, Part, PartType, Session, SessionStatus, SessionSummary } from './types'
import { inferPartType } from './helpers'
import { migrate } from './migration'
import {
  getSession, listSessions, getLastSession,
  insertSession, updateSessionFields, deleteSessionCascade,
  getMessages, getMessage, searchMessages, getMessagesAsModelMessages,
  insertMessage, touchSession,
  getParts, insertPart,
  getSessionStats, trimOldMessages,
} from './query-builder'

export type { Message, Part, PartType, Session, SessionStatus, SessionSummary }

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
    migrate(this.db)
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
    const now = Date.now()
    const session: Session = {
      id: `ses_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
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

    insertSession(this.db, session)
    return session
  }

  getSession(id: string): Session | null {
    return getSession(this.db, id)
  }

  listSessions(options: {
    directory?: string
    parentId?: string
    limit?: number
    offset?: number
  } = {}): Session[] {
    return listSessions(this.db, options)
  }

  updateSession(id: string, updates: Partial<Pick<Session, 'title' | 'status' | 'model' | 'provider' | 'tokenUsage' | 'cost' | 'summary' | 'lastCheckpointMessageId'>>): Session | null {
    if (!getSession(this.db, id)) return null
    updateSessionFields(this.db, id, updates)
    return getSession(this.db, id)
  }

  deleteSession(id: string): boolean {
    deleteSessionCascade(this.db, id)
    return true
  }

  /** 压缩后裁剪旧消息：删除除最近 keepCount 条以外的所有消息 */
  trimOldMessages(sessionId: string, keepCount: number): number {
    return trimOldMessages(this.db, sessionId, keepCount)
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
    const now = Date.now()
    const message: Message = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      sessionId: input.sessionId,
      role: input.role,
      content: input.content,
      agent: input.agent,
      model: input.model,
      tokenUsage: input.tokenUsage,
      cost: input.cost,
      createdAt: now,
    }

    insertMessage(this.db, message)
    touchSession(this.db, input.sessionId, now)
    return message
  }

  getMessages(sessionId: string, options: { limit?: number; before?: number } = {}): Message[] {
    return getMessages(this.db, sessionId, options)
  }

  getMessage(id: string): Message | null {
    return getMessage(this.db, id)
  }

  /** 获取消息，支持 contextFrom/contextWatermark 上下文继承 */
  getMessagesWithContext(sessionId: string): Message[] {
    const session = this.getSession(sessionId)
    if (!session) return []

    let result: Message[] = []
    if (session.contextFrom) {
      const parentMsgs = this.getMessages(session.contextFrom)
      if (session.contextWatermark) {
        const idx = parentMsgs.findIndex(m => m.id === session.contextWatermark)
        result = idx >= 0 ? parentMsgs.slice(0, idx + 1) : parentMsgs
      } else {
        result = parentMsgs
      }
    }

    result.push(...this.getMessages(sessionId))
    return result
  }

  /**
   * 把 AI SDK 格式的消息（含完整 parts）持久化到 messages + parts 表。
   * content 数组是 AI SDK ModelMessage 格式。
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
    const now = Date.now()
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const contentJson = JSON.stringify(input.content)

    insertMessage(this.db, {
      id: messageId,
      sessionId: input.sessionId,
      role: input.role,
      content: contentJson,
      agent: input.agent,
      model: input.model,
      tokenUsage: input.tokenUsage,
      cost: input.cost,
      createdAt: now,
    })
    touchSession(this.db, input.sessionId, now)

    const createdParts: Part[] = []
    for (const c of input.content) {
      if (!c || typeof c !== 'object') continue
      const toolArgs = c.input ?? c.args
      const toolResult = c.output?.value ?? c.result ?? (typeof c.output === 'string' ? c.output : undefined)
      createdParts.push(this.addPart({
        messageId,
        type: inferPartType(c.type),
        content: c.text ?? JSON.stringify(toolArgs ?? c.output ?? c),
        toolName: c.toolName,
        toolCallId: c.toolCallId,
        args: toolArgs,
        result: toolResult,
        metadata: undefined,
      }))
    }

    return {
      message: {
        id: messageId, sessionId: input.sessionId, role: input.role,
        content: contentJson, agent: input.agent, model: input.model,
        tokenUsage: input.tokenUsage, cost: input.cost, createdAt: now,
      },
      parts: createdParts,
    }
  }

  /** 读取 session 的 messages，重建 AI SDK ModelMessage[] 格式 */
  getMessagesAsModelMessages(
    sessionId: string,
    options: { limit?: number } = {},
  ): Array<{ role: string; content: any[] }> {
    return getMessagesAsModelMessages(this.db, sessionId, options)
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
    const part: Part = {
      id: `prt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      messageId: input.messageId,
      type: input.type,
      content: input.content,
      toolName: input.toolName,
      toolCallId: input.toolCallId,
      args: input.args,
      result: input.result,
      metadata: input.metadata,
      createdAt: Date.now(),
    }

    insertPart(this.db, part)
    return part
  }

  getParts(messageId: string): Part[] {
    return getParts(this.db, messageId)
  }

  getSessionStats(sessionId: string): {
    messageCount: number
    tokenUsage: { input: number; output: number; total: number }
    cost: number
    duration: number
  } {
    return getSessionStats(this.db, sessionId)
  }

  searchMessages(sessionId: string, query: string, limit = 10): Message[] {
    return searchMessages(this.db, sessionId, query, limit)
  }

  getLastSession(directory?: string): Session | null {
    return getLastSession(this.db, directory)
  }

  close(): void {
    this.db.close()
  }
}