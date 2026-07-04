import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { SessionManager } from '../session'
import { join } from 'path'
import { tmpdir } from 'os'
import { rm } from 'fs/promises'

const TEST_DB = join(tmpdir(), `licode-session-raw-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`)
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

describe('SessionManager part metadata 不应包含完整原始对象副本', () => {
  it('appendMessageWithParts 不应把完整原始 part 对象存到 parts.metadata', () => {
    const session = manager.createSession({
      title: 'raw-meta-test',
      directory: '/test/raw-meta',
    })

    const largeContent = 'x'.repeat(10_000)
    manager.appendMessageWithParts({
      sessionId: session.id,
      role: 'assistant',
      content: [
        { type: 'text', text: 'hi' },
        { type: 'tool-call', toolCallId: 'tc1', toolName: 'bash', input: { cmd: largeContent } },
      ],
    })

    const messages = manager.getMessages(session.id)
    expect(messages.length).toBe(1)

    // 通过 SQLite raw query 直接拿 part 的 metadata 字段，避免走 ORM 重建
    const rows = manager['db']
      .query(`SELECT id, metadata FROM parts WHERE message_id = ?`)
      .all(messages[0].id) as any[]

    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      // metadata 要么为 NULL，要么是一个轻量引用，绝不能存完整原始对象
      if (row.metadata !== null && row.metadata !== undefined) {
        const parsed = JSON.parse(row.metadata)
        // 修复前：{ raw: { type: 'tool-call', toolCallId: 'tc1', ... } }
        // 修复后：null 或 {} 或只含轻量字段
        expect(parsed).not.toHaveProperty('raw')
        // 原始对象的"大字段"不应进入 metadata
        const serialized = JSON.stringify(parsed)
        expect(serialized.length).toBeLessThan(200) // 轻量引用，不应是几 KB
      }
    }
  })

  it('getParts 返回的 Part.metadata 不包含 .raw 字段', () => {
    const session = manager.createSession({
      title: 'raw-meta-test-2',
      directory: '/test/raw-meta-2',
    })
    manager.appendMessageWithParts({
      sessionId: session.id,
      role: 'tool',
      content: [{ type: 'tool-result', toolCallId: 'tc1', toolName: 'bash', output: { type: 'text', value: 'ok' } }],
    })
    const messages = manager.getMessages(session.id)
    const parts = manager.getParts(messages[0].id)
    for (const p of parts) {
      if (p.metadata) {
        expect(p.metadata).not.toHaveProperty('raw')
      }
    }
  })
})