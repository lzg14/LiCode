/**
 * 端到端测试：模拟两次 execute() 调用，验证第二次能拿到完整的 tool-call/tool-result 历史。
 * 用 mock LLM（mock generateText）替换真实模型，模拟 read 工具调用。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { rm, mkdir, writeFile } from 'fs/promises'
import { registerBuiltinTools } from '../../tools/builtin'

const TS = String(Date.now())
const TEST_DIR = join(tmpdir(), `licode-exec-data-${TS}`)
const TEST_FILE = join(TEST_DIR, 'hello.txt')

beforeAll(async () => {
  await mkdir(TEST_DIR, { recursive: true })
  await writeFile(TEST_FILE, 'mock file content', 'utf-8')
  registerBuiltinTools()
})

describe('Cross-conversation context recovery', () => {
  it('second execute() call sees full tool-call/tool-result history from first call', async () => {
    const { SessionManager } = await import('../../session/session')
    const { execute } = await import('../phases/execute')
    const { globalToolRegistry } = await import('../../tools/registry')

    const TEST_DB = join(tmpdir(), `licode-exec-test-${Date.now()}.db`)

    // 用 vi.hoisted 声明全局 mock 收集器
    const capturedPrompts: any[][] = [];
    let callCount = 0;
    (globalThis as any).__mockCallCount = 0;
    (globalThis as any).__mockPrompts = capturedPrompts

    const model = {
      modelId: 'mock-model',
      provider: 'mock',
      specificationVersion: 'v3',
      doGenerate: async (options: any) => {
        const count = callCount++
        capturedPrompts.push(options.prompt)
        // AI SDK v6：返回用 content 数组，不用 text + toolCalls 平铺
        if (count === 0) {
          return {
            content: [
              { type: 'text' as const, text: '我来看看这个文件' },
              { type: 'tool-call' as const, toolCallId: 'call_xyz_1', toolName: 'read', input: JSON.stringify({ path: TEST_FILE }) },
            ],
            finishReason: 'tool-calls',
            usage: { inputTokens: { total: 100 }, outputTokens: { total: 30 } },
            rawResponse: { headers: {} },
          }
        }
        return {
          content: [
            { type: 'text' as const, text: '我已经读到文件内容了' },
          ],
          finishReason: 'stop',
          usage: { inputTokens: { total: 150 }, outputTokens: { total: 50 } },
          rawResponse: { headers: {} },
        }
      },
      doStream: async (_options: any) => ({
        stream: (async function*() {})(),
        content: [],
        finishReason: 'stop',
        usage: { inputTokens: { total: 0 }, outputTokens: { total: 0 } },
        rawResponse: { headers: {} },
      }),
    } as any

    const manager = new SessionManager(TEST_DB)
    const session = manager.createSession({ title: 'Cross-call', directory: TEST_DIR })

    // loop.ts 在 execute 前会先 addMessage。测试直接 execute，需模拟
    manager.addMessage({ sessionId: session.id, role: 'user', content: '读 hello.txt 这个文件' })

    // ===== 第一次对话 =====
    await execute({
      model,
      userInput: '读 hello.txt 这个文件',
      sessionId: session.id,
      sessionManager: manager,
      cwd: TEST_DIR,
    })

    // 验证第一次对话后的持久化状态：user + assistant(c/ tool-call) + tool
    const msgs1 = manager.getMessagesAsModelMessages(session.id)
    console.log('msgs1 roles:', msgs1.map(m => `${m.role}[${Array.isArray(m.content) ? m.content.length + ' parts' : typeof m.content}]`))
    expect(msgs1.length).toBeGreaterThanOrEqual(3)
    expect(msgs1[0].role).toBe('user')
    expect(msgs1[1].role).toBe('assistant')
    const hasToolCall = msgs1[1].content.some((c: any) => c.type === 'tool-call')
    console.log('has tool-call in msg[1]:', hasToolCall, 'parts:', JSON.stringify(msgs1[1].content))
    expect(hasToolCall).toBe(true)
    expect(msgs1[2].role).toBe('tool')
    expect(msgs1[2].content[0].type).toBe('tool-result')
    expect(msgs1[2].content[0].toolName).toBe('read')

    // ===== 第二次对话 =====
    // loop.ts 的做法：先 addMessage，再从 sessionManager 加载完整历史传给 execute
    manager.addMessage({ sessionId: session.id, role: 'user', content: '刚才那个文件讲了什么？' })
    const history2 = manager.getMessagesAsModelMessages(session.id)
    await execute({
      model,
      userInput: '刚才那个文件讲了什么？',
      history: history2,
      sessionId: session.id,
      sessionManager: manager,
      cwd: TEST_DIR,
    })

    // 验证 capturedPrompts 的最后一条是第一次对话的完整历史
    // execute() 内部用 generateText，它会把 history + 当前 user 转成 V1Prompt 传给 doGenerate
    const lastPrompt = capturedPrompts[capturedPrompts.length - 1]
    expect(lastPrompt).toBeDefined()

    // V1Prompt 里的 user/assistant/tool messages
    const users = lastPrompt.filter((m: any) => m.role === 'user')
    const assistants = lastPrompt.filter((m: any) => m.role === 'assistant')
    const tools = lastPrompt.filter((m: any) => m.role === 'tool')

    // 应该至少两个 user message（上一次 + 这一次）
    expect(users.length).toBeGreaterThanOrEqual(2)

    // assistant 含 tool-call part
    const asstWithTool = assistants.find((a: any) =>
      Array.isArray(a.content) && a.content.some((c: any) => c.type === 'tool-call')
    )
    expect(asstWithTool).toBeDefined()

    // tool 含 tool-result part
    const toolWithResult = tools.find((t: any) =>
      Array.isArray(t.content) && t.content.some((c: any) => c.type === 'tool-result')
    )
    expect(toolWithResult).toBeDefined()

    manager.close()
    await rm(TEST_DB, { force: true }).catch(() => {})
    await rm(TEST_DB + '-wal', { force: true }).catch(() => {})
    await rm(TEST_DB + '-shm', { force: true }).catch(() => {})
    await rm(TEST_DIR, { recursive: true, force: true }).catch(() => {})
  })
})