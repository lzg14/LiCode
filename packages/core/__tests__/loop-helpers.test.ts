import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { CoreLoop } from '../loop'
import { SessionManager } from '../../session/session'
import { join } from 'path'
import { tmpdir } from 'os'
import { rm, unlink } from 'fs/promises'
import { existsSync } from 'fs'

const TEST_DIR = join(tmpdir(), `licode-loop-test-${Date.now()}`)
const TEST_DB = join(TEST_DIR, 'licode-sessions.db')

let sessionId: string
let sessionManager: SessionManager

beforeAll(() => {
  sessionManager = new SessionManager(TEST_DB)

  const session = sessionManager.createSession({
    directory: TEST_DIR,
    model: 'claude-sonnet-4-20250514',
    provider: 'anthropic',
  })
  sessionId = session.id

  sessionManager.addMessage({ sessionId, role: 'user', content: 'hello world' })
  sessionManager.addMessage({ sessionId, role: 'assistant', content: 'hi there, how can I help?' })
  sessionManager.addMessage({ sessionId, role: 'user', content: 'git 怎么回退 commit' })
  sessionManager.addMessage({ sessionId, role: 'assistant', content: 'git reset 可以回退 commit' })
})

afterAll(async () => {
  // 关闭 SessionManager 的 DB 连接
  ;(sessionManager as any).db?.close?.()
  // 让 Node 事件循环处理排队的文件操作
  await new Promise(r => setTimeout(r, 100))
  try {
    if (existsSync(TEST_DIR)) {
      await rm(TEST_DIR, { recursive: true, force: true })
    }
  } catch {
    // 忽略清理错误
  }
})

// 创建与 tests 使用相同 DB 的 CoreLoop
function createLoop() {
  const config = {
    cwd: TEST_DIR,
    memory: { path: TEST_DB },
    llm: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
  } as any
  return new CoreLoop(config)
}

describe('CoreLoop', () => {
  it('getLastSessionId 返回最新 session', () => {
    const loop = createLoop()
    const lastId = loop.getLastSessionId(TEST_DIR)
    expect(lastId).toBe(sessionId)
  })

  it('getLastSessionId 对空目录返回 null', () => {
    const loop = createLoop()
    const lastId = loop.getLastSessionId('/nonexistent')
    expect(lastId === null || lastId === undefined).toBe(true)
  })
})

describe('searchSessionMessages', () => {
  it('搜索命中返回 snippet', () => {
    const loop = createLoop()
    const results = loop.searchSessionMessages(sessionId, 'git')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].snippet.toLowerCase()).toContain('git')
  })

  it('搜索不命中返回空数组', () => {
    const loop = createLoop()
    const results = loop.searchSessionMessages(sessionId, 'zzz_nonexistent_zzz')
    expect(results).toEqual([])
  })

  it('空查询返回空数组', () => {
    const loop = createLoop()
    expect(loop.searchSessionMessages(sessionId, '')).toEqual([])
  })

  it('限制返回数量', () => {
    const loop = createLoop()
    const results = loop.searchSessionMessages(sessionId, 'a', 1)
    expect(results.length).toBeLessThanOrEqual(1)
  })
})

describe('getSessionMessages', () => {
  it('返回纯文本消息列表', () => {
    const loop = createLoop()
    const msgs = loop.getSessionMessages(sessionId)
    expect(msgs.length).toBeGreaterThan(0)
    expect(msgs[0]).toHaveProperty('role')
    expect(msgs[0]).toHaveProperty('content')
  })

  it('空 sessionId 返回空数组', () => {
    const loop = createLoop()
    expect(loop.getSessionMessages('')).toEqual([])
  })
})

describe('compactSession', () => {
  it('不存在的 sessionId 返回 null', async () => {
    const loop = createLoop()
    const result = await loop.compactSession('non-existent')
    expect(result).toBeNull()
  })

  it('消息数未达压缩阈值返回 saved=0', async () => {
    const loop = createLoop()
    const result = await loop.compactSession(sessionId)
    expect(result).not.toBeNull()
    expect(result!.saved).toBe(0)
    expect(result!.summary).toContain('未达压缩阈值')
  })
})

describe('checkpoint', () => {
  it('save 后 restore 能取回正确的 phase', async () => {
    const loop = createLoop()
    const saved = await (loop as any).checkpointManager.save('test-session', {
      phase: 'EXECUTE',
      context: { effortLevel: 2 },
      timestamp: Date.now(),
    })
    expect(saved.sessionId).toBe('test-session')
    expect(saved.version).toBe(1)

    const restored = await (loop as any).checkpointManager.restore('test-session')
    expect(restored).not.toBeNull()
    expect(restored!.phase).toBe('EXECUTE')
  })
})
