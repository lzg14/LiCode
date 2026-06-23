import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { SessionManager } from '../session'
import { join } from 'path'
import { tmpdir } from 'os'
import { rm, mkdir, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { CHECKPOINT_TEMPLATE, MEMORY_TEMPLATE, writeCheckpoint, writeMemory, loadCheckpoint, loadMemory, hasCheckpoint, ensureCheckpointTemplate, ensureMemoryTemplate } from '../checkpoint'
import { checkpointPath, memoryPath, metaDir, ensureDir } from '../checkpoint-paths'
import { buildSessionContext, buildRecallReminder, buildContextInheritance } from '../prompt'
import { searchMemory, getRecentMemoryEntries } from '../memory'
import { computeBoundary } from '../checkpoint'
import { Database } from 'bun:sqlite'

const TEST_DB = join(tmpdir(), `licode-session-test-${Date.now()}.db`)
const TEST_DATA_DIR = join(tmpdir(), `licode-session-data-${Date.now()}`)
let manager: SessionManager

beforeAll(async () => {
  manager = new SessionManager(TEST_DB)
  await mkdir(TEST_DATA_DIR, { recursive: true })
})

afterAll(async () => {
  manager.close()
  await rm(TEST_DB, { force: true }).catch(() => {})
  await rm(TEST_DB + '-wal', { force: true }).catch(() => {})
  await rm(TEST_DB + '-shm', { force: true }).catch(() => {})
  await rm(TEST_DATA_DIR, { recursive: true, force: true }).catch(() => {})
})

describe('SessionManager', () => {
  let sessionId: string

  it('should create session', () => {
    const session = manager.createSession({
      title: 'Test Session',
      directory: '/test/project',
    })

    expect(session.id).toBeTruthy()
    expect(session.title).toBe('Test Session')
    expect(session.directory).toBe('/test/project')
    expect(session.status).toBe('idle')
    sessionId = session.id
  })

  it('should get session', () => {
    const session = manager.getSession(sessionId)
    expect(session).not.toBeNull()
    expect(session!.id).toBe(sessionId)
    expect(session!.title).toBe('Test Session')
  })

  it('should list sessions', () => {
    const sessions = manager.listSessions()
    expect(sessions.length).toBeGreaterThan(0)
  })

  it('should update session', () => {
    const updated = manager.updateSession(sessionId, { title: 'Updated Title', status: 'running' })
    expect(updated).not.toBeNull()
    expect(updated!.title).toBe('Updated Title')
    expect(updated!.status).toBe('running')
  })

  it('should add message', () => {
    const message = manager.addMessage({
      sessionId,
      role: 'user',
      content: 'Hello, licode!',
    })

    expect(message.id).toBeTruthy()
    expect(message.sessionId).toBe(sessionId)
    expect(message.content).toBe('Hello, licode!')
  })

  it('should add assistant message with token usage', () => {
    const message = manager.addMessage({
      sessionId,
      role: 'assistant',
      content: 'Hello! How can I help you?',
      agent: 'build',
      model: 'claude-sonnet-4-20250514',
      tokenUsage: { input: 100, output: 50 },
      cost: 0.001,
    })

    expect(message.tokenUsage).toEqual({ input: 100, output: 50 })
    expect(message.cost).toBe(0.001)
  })

  it('should get messages', () => {
    const messages = manager.getMessages(sessionId)
    expect(messages.length).toBe(2)
    expect(messages[0].role).toBe('user')
    expect(messages[1].role).toBe('assistant')
  })

  it('should add and get parts', () => {
    const messages = manager.getMessages(sessionId)
    const userMsg = messages[0]

    const part = manager.addPart({
      messageId: userMsg.id,
      type: 'text',
      content: 'Hello, licode!',
    })

    expect(part.id).toBeTruthy()
    expect(part.type).toBe('text')

    const parts = manager.getParts(userMsg.id)
    expect(parts.length).toBe(1)
    expect(parts[0].content).toBe('Hello, licode!')
  })

  it('should add tool call part', () => {
    const messages = manager.getMessages(sessionId)
    const assistantMsg = messages[1]

    const part = manager.addPart({
      messageId: assistantMsg.id,
      type: 'tool-call',
      content: 'Calling read tool',
      toolName: 'read',
      toolCallId: 'call_123',
      args: { path: '/test/file.txt' },
    })

    expect(part.toolName).toBe('read')
    expect(part.args).toEqual({ path: '/test/file.txt' })
  })

  it('should get session stats', () => {
    const stats = manager.getSessionStats(sessionId)
    expect(stats.messageCount).toBe(2)
    expect(stats.tokenUsage.input).toBe(100)
    expect(stats.tokenUsage.output).toBe(50)
    expect(stats.cost).toBe(0.001)
  })

  it('should search messages', () => {
    const results = manager.searchMessages(sessionId, 'licode')
    expect(results.length).toBeGreaterThan(0)
  })

  it('should delete session', () => {
    const deleted = manager.deleteSession(sessionId)
    expect(deleted).toBe(true)

    const session = manager.getSession(sessionId)
    expect(session).toBeNull()
  })

  it('should handle non-existent session', () => {
    const session = manager.getSession('non-existent')
    expect(session).toBeNull()

    const updated = manager.updateSession('non-existent', { title: 'test' })
    expect(updated).toBeNull()
  })
})

describe('AI SDK message persistence', () => {
  it('appendMessageWithParts stores text parts', () => {
    const session = manager.createSession({ title: 'AI SDK persistence', directory: '/test' })
    const { message, parts } = manager.appendMessageWithParts({
      sessionId: session.id,
      role: 'user',
      content: [{ type: 'text', text: '你好' }],
    })
    expect(message.role).toBe('user')
    expect(parts.length).toBe(1)
    expect(parts[0].type).toBe('text')
    expect(parts[0].content).toBe('你好')
  })

  it('appendMessageWithParts stores tool-call and tool-result parts', () => {
    const session = manager.createSession({ title: 'tool parts', directory: '/test' })
    manager.appendMessageWithParts({
      sessionId: session.id,
      role: 'user',
      content: [{ type: 'text', text: '读文件' }],
    })
    manager.appendMessageWithParts({
      sessionId: session.id,
      role: 'assistant',
      content: [
        { type: 'text', text: '好的，我读' },
        { type: 'tool-call', toolCallId: 'call_1', toolName: 'read', input: { path: '/a.txt' } },
      ],
    })
    manager.appendMessageWithParts({
      sessionId: session.id,
      role: 'tool',
      content: [{
        type: 'tool-result',
        toolCallId: 'call_1',
        toolName: 'read',
        output: { type: 'text', value: '文件内容' },
      }],
    })

    const msgs = manager.getMessagesAsModelMessages(session.id)
    expect(msgs.length).toBe(3)
    expect(msgs[0].content[0]).toEqual({ type: 'text', text: '读文件' })
    expect(msgs[1].content[1]).toEqual({
      type: 'tool-call',
      toolCallId: 'call_1',
      toolName: 'read',
      input: { path: '/a.txt' },
    })
    expect(msgs[2].content[0]).toEqual({
      type: 'tool-result',
      toolCallId: 'call_1',
      toolName: 'read',
      output: { type: 'text', value: '文件内容' },
    })
  })

  it('getMessagesAsModelMessages handles legacy plain-text content', () => {
    const session = manager.createSession({ title: 'legacy', directory: '/test' })
    manager.addMessage({ sessionId: session.id, role: 'user', content: '旧格式纯文本' })
    const msgs = manager.getMessagesAsModelMessages(session.id)
    expect(msgs[0].content).toEqual([{ type: 'text', text: '旧格式纯文本' }])
  })
})

describe('Schema migration', () => {
  it('should migrate old schema with missing columns', () => {
    const oldDbPath = join(tmpdir(), `licode-migration-test-${Date.now()}.db`)

    // 模拟旧 schema（缺少 context_from 等列）
    const oldDb = new Database(oldDbPath)
    oldDb.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        directory TEXT NOT NULL,
        parent_id TEXT,
        status TEXT DEFAULT 'idle',
        model TEXT,
        provider TEXT,
        token_input INTEGER DEFAULT 0,
        token_output INTEGER DEFAULT 0,
        cost REAL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER
      );
    `)
    oldDb.exec(`
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        agent TEXT,
        model TEXT,
        token_input INTEGER DEFAULT 0,
        token_output INTEGER DEFAULT 0,
        cost REAL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
    `)
    oldDb.exec(`
      CREATE TABLE parts (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_name TEXT,
        tool_call_id TEXT,
        args TEXT,
        result TEXT,
        metadata TEXT,
        created_at INTEGER NOT NULL
      );
    `)
    oldDb.close()

    // 用 SessionManager 打开，应该自动迁移
    const migrated = new SessionManager(oldDbPath)

    // 验证新列已加 —— update 时不报错即说明列存在
    const session = migrated.createSession({ title: 'After migration', directory: '/migrate' })
    expect(session.contextFrom).toBeUndefined()
    expect(session.contextWatermark).toBeUndefined()

    const updated = migrated.updateSession(session.id, {
      summary: { additions: 5, deletions: 2, files: ['a.ts'] },
      lastCheckpointMessageId: 'msg_x',
    })
    expect(updated!.summary!.additions).toBe(5)
    expect(updated!.lastCheckpointMessageId).toBe('msg_x')

    migrated.close()
    rm(oldDbPath, { force: true })
    rm(oldDbPath + '-wal', { force: true })
    rm(oldDbPath + '-shm', { force: true })
  })

  it('should be idempotent on new schema', () => {
    // 新表走 SCHEMA + 迁移，迁移是 no-op，不应报错
    const dbPath = join(tmpdir(), `licode-idempotent-${Date.now()}.db`)
    const m1 = new SessionManager(dbPath)
    const m2 = new SessionManager(dbPath)
    m1.close()
    m2.close()
    rm(dbPath, { force: true })
    rm(dbPath + '-wal', { force: true })
    rm(dbPath + '-shm', { force: true })
  })
})

describe('Context Inheritance', () => {
  it('should create session with contextFrom/contextWatermark', () => {
    const parent = manager.createSession({
      title: 'Parent Session',
      directory: '/test/project',
    })

    const child = manager.createSession({
      title: 'Child Session',
      directory: '/test/project',
      parentId: parent.id,
      contextFrom: parent.id,
      contextWatermark: undefined,
    })

    expect(child.contextFrom).toBe(parent.id)
    expect(child.parentId).toBe(parent.id)

    const fetched = manager.getSession(child.id)
    expect(fetched!.contextFrom).toBe(parent.id)
    expect(fetched!.parentId).toBe(parent.id)
  })

  it('should get messages with context inheritance', () => {
    const parent = manager.createSession({
      title: 'Parent for Inheritance',
      directory: '/test/project',
    })

    const msg1 = manager.addMessage({ sessionId: parent.id, role: 'user', content: 'First message' })
    const msg2 = manager.addMessage({ sessionId: parent.id, role: 'user', content: 'Second message' })

    const child = manager.createSession({
      title: 'Child with Watermark',
      directory: '/test/project',
      contextFrom: parent.id,
      contextWatermark: msg2.id,
    })

    const childMsg = manager.addMessage({ sessionId: child.id, role: 'user', content: 'Child message' })

    const inheritedMsgs = manager.getMessagesWithContext(child.id)
    expect(inheritedMsgs.length).toBe(3) // 2 parent + 1 child
    expect(inheritedMsgs[0].content).toBe('First message')
    expect(inheritedMsgs[1].content).toBe('Second message')
    expect(inheritedMsgs[2].content).toBe('Child message')
  })

  it('should support summary in session', () => {
    const session = manager.createSession({
      title: 'Session with Summary',
      directory: '/test/project',
    })

    const updated = manager.updateSession(session.id, {
      summary: { additions: 100, deletions: 50, files: ['src/main.ts'] },
    })

    expect(updated!.summary).toEqual({
      additions: 100,
      deletions: 50,
      files: ['src/main.ts'],
    })

    const fetched = manager.getSession(session.id)
    expect(fetched!.summary!.additions).toBe(100)
    expect(fetched!.summary!.files).toEqual(['src/main.ts'])
  })

  it('should support lastCheckpointMessageId', () => {
    const session = manager.createSession({
      title: 'Session with Checkpoint',
      directory: '/test/project',
    })

    const msg = manager.addMessage({ sessionId: session.id, role: 'user', content: 'test' })

    const updated = manager.updateSession(session.id, { lastCheckpointMessageId: msg.id })
    expect(updated!.lastCheckpointMessageId).toBe(msg.id)

    const fetched = manager.getSession(session.id)
    expect(fetched!.lastCheckpointMessageId).toBe(msg.id)
  })

  it('should get last session', () => {
    const last = manager.getLastSession()
    expect(last).not.toBeNull()
    expect(last!.id).toBeTruthy()
  })

  it('should get last session by directory', () => {
    const last = manager.getLastSession('/test/project')
    expect(last).not.toBeNull()
    expect(last!.directory).toBe('/test/project')
  })
})

describe('Checkpoint', () => {
  const sessionID = 'ses_checkpoint_test'
  const projectID = 'proj_checkpoint_test'

  it('should have CHECKPOINT_TEMPLATE', () => {
    expect(CHECKPOINT_TEMPLATE).toContain('# Session checkpoint')
    expect(CHECKPOINT_TEMPLATE).toContain('Active intent')
    expect(CHECKPOINT_TEMPLATE).toContain('Next concrete action')
  })

  it('should have MEMORY_TEMPLATE', () => {
    expect(MEMORY_TEMPLATE).toContain('# Project memory')
    expect(MEMORY_TEMPLATE).toContain('Project context')
    expect(MEMORY_TEMPLATE).toContain('Rules')
  })

  it('should ensure checkpoint template files', async () => {
    const cpPath = checkpointPath(sessionID, TEST_DATA_DIR)
    ensureCheckpointTemplate(cpPath)
    expect(existsSync(cpPath)).toBe(true)

    const content = await import('fs').then(fs => fs.readFileSync(cpPath, 'utf-8'))
    expect(content).toBe(CHECKPOINT_TEMPLATE)
  })

  it('should ensure memory template files', async () => {
    const mpPath = memoryPath(projectID, TEST_DATA_DIR)
    ensureMemoryTemplate(mpPath)
    expect(existsSync(mpPath)).toBe(true)

    const content = await import('fs').then(fs => fs.readFileSync(mpPath, 'utf-8'))
    expect(content).toBe(MEMORY_TEMPLATE)
  })

  it('should write and load checkpoint', () => {
    const content = `# Session checkpoint\n\nActive intent: Test task\n`
    writeCheckpoint({
      sessionID,
      dataDir: TEST_DATA_DIR,
      projectID,
      useCount: 1,
      text: content,
    })

    const loaded = loadCheckpoint(sessionID, TEST_DATA_DIR)
    expect(loaded).toBe(content)

    expect(hasCheckpoint(sessionID, TEST_DATA_DIR)).toBe(true)
  })

  it('should write and load memory', () => {
    const content = `# Project memory\n\nProject context: Test project\n`
    writeMemory({ projectID, dataDir: TEST_DATA_DIR, text: content })

    const loaded = loadMemory(projectID, TEST_DATA_DIR)
    expect(loaded).toBe(content)
  })

  it('should return undefined for non-existent checkpoint', () => {
    const loaded = loadCheckpoint('non_existent', TEST_DATA_DIR)
    expect(loaded).toBeUndefined()
  })

  it('should compute boundary', () => {
    const msgs = [
      { info: { id: '1', role: 'user', finish: undefined } },
      { info: { id: '2', role: 'assistant', finish: 'stop' } } as any,
      { info: { id: '3', role: 'user', finish: undefined } },
      { info: { id: '4', role: 'assistant', finish: 'stop' } } as any,
      { info: { id: '5', role: 'user', finish: undefined } },
    ]

    const boundary = computeBoundary(msgs)
    expect(boundary).toBe('3')
  })

  it('should handle empty messages in boundary', () => {
    const boundary = computeBoundary([])
    expect(boundary).toBe('')
  })

  it('should render rebuild context', () => {
    const cpContent = `# Session checkpoint\n\nActive intent: Fix bug\n`
    writeCheckpoint({
      sessionID,
      dataDir: TEST_DATA_DIR,
      projectID,
      useCount: 2,
      text: cpContent,
    })

    const ctx = buildSessionContext({
      sessionID,
      dataDir: TEST_DATA_DIR,
      projectID,
    })

    expect(ctx).toContain('Session checkpoint')
    expect(ctx).toContain('Fix bug')
  })
})

describe('Prompt', () => {
  it('should build recall reminder', () => {
    const reminder = buildRecallReminder('ses_test', TEST_DATA_DIR)
    expect(reminder).toContain('<system-reminder>')
    expect(reminder).toContain('checkpoint.md')
    expect(reminder).toContain('notes.md')
    expect(reminder).toContain('</system-reminder>')
  })

  it('should build context inheritance', () => {
    const parent = manager.createSession({
      title: 'Parent',
      directory: '/test/project',
    })
    manager.addMessage({ sessionId: parent.id, role: 'user', content: 'Parent msg' })

    const child = manager.createSession({
      title: 'Child',
      directory: '/test/project',
      contextFrom: parent.id,
    })

    const ctx = buildContextInheritance({
      currentSessionID: child.id,
      sessionManager: manager,
      dataDir: TEST_DATA_DIR,
    })

    expect(ctx).toContain('<system-reminder>')
    expect(ctx).toContain('inherits context')
    expect(ctx).toContain(parent.id)
  })

  it('should return empty for session without contextFrom', () => {
    const session = manager.createSession({ title: 'Standalone', directory: '/test/project' })
    const ctx = buildContextInheritance({
      currentSessionID: session.id,
      sessionManager: manager,
      dataDir: TEST_DATA_DIR,
    })
    expect(ctx).toBe('')
  })

  it('should build session context', () => {
    const session = manager.createSession({ title: 'Session Ctx', directory: '/test/project' })

    const ctx = buildSessionContext({
      sessionID: session.id,
      dataDir: TEST_DATA_DIR,
      projectID: 'test',
    })

    expect(typeof ctx).toBe('string')
  })
})

describe('Memory', () => {
  it('should search memory files', async () => {
    const memDir = join(TEST_DATA_DIR, 'memory', 'projects', 'memory-test')
    const memFile = join(memDir, 'MEMORY.md')
    await mkdir(memDir, { recursive: true })
    await writeFile(memFile, '# Project memory\n\nRules: Always use TypeScript\n')

    const results = searchMemory({
      query: 'TypeScript',
      dataDir: TEST_DATA_DIR,
      projectID: 'memory-test',
    })

    expect(results.length).toBeGreaterThan(0)
    expect(results[0].path).toContain('MEMORY.md')
  })

  it('should return empty for no matches', () => {
    const results = searchMemory({
      query: 'zzzznotfound',
      dataDir: TEST_DATA_DIR,
    })
    expect(results.length).toBe(0)
  })

  it('should get recent memory entries', () => {
    const entries = getRecentMemoryEntries(TEST_DATA_DIR)
    expect(Array.isArray(entries)).toBe(true)
  })
})

describe('Checkpoint paths', () => {
  it('should generate correct paths', () => {
    const sep = require('path').sep
    const cp = checkpointPath('ses_123', TEST_DATA_DIR)
    expect(cp).toContain(`memory${sep}sessions${sep}ses_123${sep}checkpoint.md`)

    const mp = memoryPath('proj_456', TEST_DATA_DIR)
    expect(mp).toContain(`memory${sep}projects${sep}proj_456${sep}MEMORY.md`)

    const meta = metaDir('ses_789', TEST_DATA_DIR)
    expect(meta).toContain(`memory${sep}sessions${sep}ses_789`)
  })

  it('should ensure directory', () => {
    const testDir = join(TEST_DATA_DIR, 'test-ensure-dir')
    ensureDir(testDir)
    expect(existsSync(testDir)).toBe(true)
  })
})
