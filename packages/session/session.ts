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
  getSessionStats, trimOldMessages, archiveOldMessages, archiveByTokenBudget, estimateTokens,
  getChildMessages, getMessageBranch, getMessageTree, getBranchMessages, updateMessageParent,
  type MessageTreeNode,
} from './utils/query-builder'

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

  /** 压缩后裁剪旧消息：删除除最近 keepCount 条以外的所有消息
   * @deprecated 请使用 archiveOldMessages 代替
   */
  trimOldMessages(sessionId: string, keepCount: number): number {
    return trimOldMessages(this.db, sessionId, keepCount)
  }

  /** 标记旧消息为 archived（不删除，只置位） */
  archiveOldMessages(sessionId: string, keepCount: number): number {
    return archiveOldMessages(this.db, sessionId, keepCount)
  }

  /** 基于 token 预算归档旧消息 */
  archiveByTokenBudget(sessionId: string, maxTokens: number, keepRecent: number = 10): number {
    return archiveByTokenBudget(this.db, sessionId, maxTokens, keepRecent)
  }

  /** 估算 token 数量 */
  estimateTokens(text: string): number {
    return estimateTokens(text)
  }

  // ============================================================
  // 消息级分支
  // ============================================================

  /** 获取消息的子消息 */
  getChildMessages(parentId: string): Message[] {
    return getChildMessages(this.db, parentId)
  }

  /** 获取消息的完整分支（从根到叶） */
  getMessageBranch(messageId: string): Message[] {
    return getMessageBranch(this.db, messageId)
  }

  /** 获取会话的消息树 */
  getMessageTree(sessionId: string): MessageTreeNode[] {
    return getMessageTree(this.db, sessionId)
  }

  /** 获取指定分支的消息 */
  getBranchMessages(sessionId: string, leafMessageId?: string): Message[] {
    return getBranchMessages(this.db, sessionId, leafMessageId)
  }

  /** 更新消息的 parent_id */
  updateMessageParent(messageId: string, newParentId: string | null): void {
    updateMessageParent(this.db, messageId, newParentId)
  }

  /**
   * 在当前分支末尾追加消息
   * 自动设置 parentId 为当前分支的最后一个消息
   */
  appendMessageToBranch(input: {
    sessionId: string
    role: Message['role']
    content: string
    leafMessageId?: string
    agent?: string
    model?: string
    tokenUsage?: Message['tokenUsage']
    cost?: number
  }): Message {
    // 获取当前分支的最后一个消息
    const branch = this.getBranchMessages(input.sessionId, input.leafMessageId)
    const lastMessage = branch.length > 0 ? branch[branch.length - 1] : null
    
    // 创建消息
    const message = this.addMessage({
      sessionId: input.sessionId,
      role: input.role,
      content: input.content,
      agent: input.agent,
      model: input.model,
      tokenUsage: input.tokenUsage,
      cost: input.cost,
    })
    
    // 设置 parentId
    if (lastMessage) {
      this.updateMessageParent(message.id, lastMessage.id)
    }
    
    return message
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

  // ============================================================
  // 会话树操作
  // ============================================================

  /**
   * 获取指定会话的所有子会话
   */
  getChildren(parentId: string): Session[] {
    return this.listSessions({ parentId })
  }

  /**
   * 获取会话的完整树结构（递归）
   */
  getSessionTree(sessionId: string): SessionTreeNode | null {
    const session = this.getSession(sessionId)
    if (!session) return null

    const children = this.getChildren(sessionId)
    return {
      session,
      children: children.map(c => this.getSessionTree(c.id)!).filter(Boolean),
    }
  }

  /**
   * 获取会话的祖先链（从根到当前会话）
   */
  getAncestors(sessionId: string): Session[] {
    const ancestors: Session[] = []
    let current = this.getSession(sessionId)
    
    while (current?.parentId) {
      const parent = this.getSession(current.parentId)
      if (parent) {
        ancestors.unshift(parent)
        current = parent
      } else {
        break
      }
    }
    
    return ancestors
  }

  /**
   * 从指定消息分叉会话
   * 创建一个新会话，继承原会话到指定消息的历史
   */
  forkSession(sourceSessionId: string, fromMessageId?: string): Session {
    const sourceSession = this.getSession(sourceSessionId)
    if (!sourceSession) {
      throw new Error(`Source session ${sourceSessionId} not found`)
    }

    // 创建新会话
    const newSession = this.createSession({
      title: `Forked from ${sourceSession.title}`,
      directory: sourceSession.directory,
      parentId: sourceSessionId,
      contextFrom: sourceSessionId,
      contextWatermark: fromMessageId,
      model: sourceSession.model,
      provider: sourceSession.provider,
    })

    return newSession
  }

  /**
   * 克隆会话（复制完整历史到新会话）
   */
  cloneSession(sessionId: string): Session {
    const sourceSession = this.getSession(sessionId)
    if (!sourceSession) {
      throw new Error(`Source session ${sessionId} not found`)
    }

    // 创建新会话
    const newSession = this.createSession({
      title: `Cloned from ${sourceSession.title}`,
      directory: sourceSession.directory,
      model: sourceSession.model,
      provider: sourceSession.provider,
    })

    // 复制所有消息
    const messages = this.getMessages(sessionId)
    for (const msg of messages) {
      this.addMessage({
        sessionId: newSession.id,
        role: msg.role,
        content: msg.content,
        agent: msg.agent,
        model: msg.model,
        tokenUsage: msg.tokenUsage,
        cost: msg.cost,
      })
    }

    return newSession
  }

  /**
   * 获取当前活跃分支（从指定会话沿着最后一个子会话向下）
   */
  getActiveBranch(sessionId: string): Session[] {
    const branch: Session[] = []
    let currentId: string | undefined = sessionId
    
    while (currentId) {
      const session = this.getSession(currentId)
      if (session) {
        branch.push(session)
        const children = this.getChildren(currentId)
        // 选择最新的子会话作为活跃分支
        currentId = children.length > 0 ? children[children.length - 1].id : undefined
      } else {
        break
      }
    }
    
    return branch
  }

  close(): void {
    this.db.close()
  }
}

/** 会话树节点 */
export interface SessionTreeNode {
  session: Session
  children: SessionTreeNode[]
}