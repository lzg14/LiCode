import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { SessionManager } from '../session'
import { join } from 'path'
import { tmpdir } from 'os'
import { rm } from 'fs/promises'

const TEST_DB = join(tmpdir(), `licode-session-limit-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`)
let manager: SessionManager

beforeAll(() => {
  manager = new SessionManager(TEST_DB)
})

afterAll(async () => {
  manager.close()
  await rm(TEST_DB, { force: true }).catch(() => {})
  await rm(TEST_DB + '-wal', { force: true }).catch(() => {})
  await rm(TEST_DB + '-shm', { force: true }).catch(() => {})
})

describe('SessionManager.getMessagesAsModelMessages limit 选项', () => {
  it('不传 limit 时返回所有消息（向后兼容）', () => {
    const session = manager.createSession({ title: 'all', directory: '/t/all' })
    for (let i = 0; i < 5; i++) {
      manager.appendMessageWithParts({
        sessionId: session.id,
        role: 'user',
        content: [{ type: 'text', text: `msg-${i}` }],
      })
    }
    const all = manager.getMessagesAsModelMessages(session.id)
    expect(all.length).toBe(5)
  })

  it('传 limit 时只返回最新的 N 条，避免加载整个 history', () => {
    const session = manager.createSession({ title: 'limit', directory: '/t/limit' })
    for (let i = 0; i < 10; i++) {
      manager.appendMessageWithParts({
        sessionId: session.id,
        role: 'user',
        content: [{ type: 'text', text: `msg-${i}` }],
      })
    }
    const tail3 = manager.getMessagesAsModelMessages(session.id, { limit: 3 })
    expect(tail3.length).toBe(3)
    // 顺序保持原顺序（最早的在前）
    expect((tail3[0].content[0] as any).text).toBe('msg-7')
    expect((tail3[1].content[0] as any).text).toBe('msg-8')
    expect((tail3[2].content[0] as any).text).toBe('msg-9')
  })

  it('limit 大于消息总数时返回全部，不报错', () => {
    const session = manager.createSession({ title: 'biglimit', directory: '/t/big' })
    manager.appendMessageWithParts({
      sessionId: session.id,
      role: 'user',
      content: [{ type: 'text', text: 'only' }],
    })
    const msgs = manager.getMessagesAsModelMessages(session.id, { limit: 1000 })
    expect(msgs.length).toBe(1)
  })
})