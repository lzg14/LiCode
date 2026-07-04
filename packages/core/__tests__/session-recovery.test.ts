import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { registerBuiltinTools } from '../../tools/builtin'

const TS = String(Date.now())
const TEST_DIR = join(tmpdir(), `licode-exec-data-${TS}`)
const TEST_FILE = join(TEST_DIR, 'hello.txt')

const capturedMessages: any[][] = []
let streamCallCount = 0

vi.mock('ai', () => ({
  streamText: (...args: any[]) => (globalThis as any).__mockStreamText__?.(...args),
  generateText: (...args: any[]) => (globalThis as any).__mockGenerateText__?.(...args),
  tool: (def: any) => def,
  jsonSchema: (schema: any) => schema,
}))

const streamTextResponse = (text: string, toolCalls: any[] = []) => ({
  fullStream: (async function* () {
    if (text) yield { type: 'text-delta', text }
    for (const tc of toolCalls) yield { type: 'tool-call', ...tc }
  })(),
  text: Promise.resolve(text),
  toolCalls: Promise.resolve(toolCalls),
  toolResults: Promise.resolve([]),
  usage: Promise.resolve({ inputTokens: 50, outputTokens: 20, totalTokens: 70 }),
  finishReason: Promise.resolve(toolCalls.length > 0 ? 'tool-calls' : 'stop'),
})

beforeAll(async () => {
  await mkdir(TEST_DIR, { recursive: true })
  await writeFile(TEST_FILE, 'mock file content', 'utf-8')
  registerBuiltinTools()
})

afterAll(() => {
  vi.restoreAllMocks()
})

describe('Cross-conversation context recovery', () => {
  it('second execute() call sees full tool-call/tool-result history from first call', async () => {
    const { SessionManager } = await import('../../session/session')
    const { execute } = await import('../phases/execute')

    const TEST_DB = join(tmpdir(), `licode-exec-test-${Date.now()}.db`)
    capturedMessages.length = 0
    streamCallCount = 0

    const responses = [
      streamTextResponse('我来看看这个文件', [
        { toolName: 'read', input: { path: TEST_FILE }, toolCallId: 'call_xyz_1' },
      ]),
      streamTextResponse('我已经读到文件内容了'),
    ]

    ;(globalThis as any).__mockStreamText__ = (opts: any) => {
      capturedMessages.push(opts.messages)
      const idx = streamCallCount++
      return responses[idx] ?? responses[responses.length - 1]
    }

    const manager = new SessionManager(TEST_DB)
    const session = manager.createSession({ title: 'Cross-call', directory: TEST_DIR })
    manager.addMessage({ sessionId: session.id, role: 'user', content: '读 hello.txt 这个文件' })

    const mockModel = { modelId: 'mock-model', provider: 'mock-provider' }

    // ===== 第一次对话 =====
    await execute({
      model: mockModel,
      userInput: '读 hello.txt 这个文件',
      sessionId: session.id,
      sessionManager: manager,
      cwd: TEST_DIR,
    })

    // 验证第一次对话后的持久化状态：user + assistant(含 tool-call) + tool
    const msgs1 = manager.getMessagesAsModelMessages(session.id)
    expect(msgs1.length).toBeGreaterThanOrEqual(3)
    expect(msgs1[0].role).toBe('user')
    expect(msgs1[1].role).toBe('assistant')
    const hasToolCall = msgs1[1].content.some((c: any) => c.type === 'tool-call')
    expect(hasToolCall).toBe(true)
    expect(msgs1[2].role).toBe('tool')
    expect(msgs1[2].content[0].type).toBe('tool-result')
    expect(msgs1[2].content[0].toolName).toBe('read')

    // ===== 第二次对话 =====
    manager.addMessage({ sessionId: session.id, role: 'user', content: '刚才那个文件讲了什么？' })
    const history2 = manager.getMessagesAsModelMessages(session.id)
    await execute({
      model: mockModel,
      userInput: '刚才那个文件讲了什么？',
      history: history2,
      sessionId: session.id,
      sessionManager: manager,
      cwd: TEST_DIR,
    })

    // 验证第二次调用时传给 LLM 的消息包含了第一次的完整历史
    const lastMessages = capturedMessages[capturedMessages.length - 1]
    expect(lastMessages).toBeDefined()

    const users = lastMessages.filter((m: any) => m.role === 'user')
    const assistants = lastMessages.filter((m: any) => m.role === 'assistant')
    const tools = lastMessages.filter((m: any) => m.role === 'tool')

    expect(users.length).toBeGreaterThanOrEqual(2)
    const asstWithTool = assistants.find((a: any) =>
      Array.isArray(a.content) && a.content.some((c: any) => c.type === 'tool-call')
    )
    expect(asstWithTool).toBeDefined()
    const toolWithResult = tools.find((t: any) =>
      Array.isArray(t.content) && t.content.some((c: any) => c.type === 'tool-result')
    )
    expect(toolWithResult).toBeDefined()

    manager.close()
    await rm(TEST_DB, { force: true }).catch(() => {})
    await rm(`${TEST_DB}-wal`, { force: true }).catch(() => {})
    await rm(`${TEST_DB}-shm`, { force: true }).catch(() => {})
    await rm(TEST_DIR, { recursive: true, force: true }).catch(() => {})
  })
})
