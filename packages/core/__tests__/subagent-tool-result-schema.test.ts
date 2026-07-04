import { describe, it, expect, vi, afterAll } from 'vitest'
import { SubagentManager } from '../subagent'
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Mock generateText 必须在 import subagent 之前；vitest 会 hoist 到文件顶部
const mockGenerateText = vi.hoisted(() => vi.fn())
vi.mock('ai', () => ({
  generateText: mockGenerateText,
  tool: (def: any) => def,
  jsonSchema: (schema: any) => schema,
}))

// 注册 read 工具（builtin.registerBuiltinTools 副作用）
import '../../tools/builtin'

const TEST_DIR = join(tmpdir(), `licode-subagent-test-${Date.now()}`)

describe('SubagentManager tool-result schema', () => {
  afterAll(() => {
    vi.restoreAllMocks()
    try {
      if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
    } catch {}
  })

  it('内部循环构造的 tool-result 必须带 type 字段（AI SDK v6 schema 要求）', async () => {
    if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true })
    const targetFile = join(TEST_DIR, 'sample.txt')
    writeFileSync(targetFile, 'hello world', 'utf-8')

    // 第一轮：LLM 调 read 工具
    mockGenerateText.mockReturnValueOnce({
      text: '我先读取文件',
      toolCalls: [{
        toolName: 'read',
        input: { path: targetFile },
        toolCallId: 'tc-1',
      }],
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      finishReason: 'tool-calls',
    })
    // 第二轮：LLM 看到工具结果后总结
    mockGenerateText.mockReturnValueOnce({
      text: '文件内容是 hello world',
      toolCalls: [],
      usage: { inputTokens: 30, outputTokens: 10, totalTokens: 40 },
      finishReason: 'stop',
    })

    const manager = new SubagentManager({
      maxConcurrent: 1,
      timeoutMs: 5000,
      blockedTools: [],
    })

    const result = await manager.spawn(
      { task: '读取 sample.txt 并告诉我内容' },
      {
        model: { modelId: 'mock', provider: 'mock' } as any,
        system: '你是一个测试助手',
        messages: [],
        cwd: TEST_DIR,
      }
    )

    // 1) 任务必须成功
    expect(result.success).toBe(true)

    // 2) 返回的 text 必须是真实内容，不能是 "(无输出)"
    expect(result.text).not.toBe('(无输出)')
    expect(result.text).toContain('文件内容是 hello world')

    // 3) 第二轮 generateText 调用时，传入的 messages 里
    //    必须有一个 role: 'tool' 的消息，且 content items 都带 type: 'tool-result'
    expect(mockGenerateText.mock.calls.length).toBeGreaterThanOrEqual(2)
    const secondCallArgs = mockGenerateText.mock.calls[1][0]
    const messages = secondCallArgs.messages as Array<{ role: string; content: any[] }>

    const toolMsg = messages.find((m) => m.role === 'tool')
    expect(toolMsg).toBeDefined()
    expect(Array.isArray(toolMsg!.content)).toBe(true)
    expect(toolMsg!.content.length).toBeGreaterThan(0)

    for (const part of toolMsg!.content) {
      expect(part.type).toBe('tool-result')
      expect(part.toolCallId).toBe('tc-1')
      expect(part.toolName).toBe('read')
      expect(part.output).toBeDefined()
      expect(part.output.type).toBe('text')
    }
  })

  it('工具抛异常时构造的 tool-result 也要带 type 字段', async () => {
    // 第一轮：LLM 调一个会抛错的工具（指向不存在的路径）
    mockGenerateText.mockReturnValueOnce({
      text: '我读一下',
      toolCalls: [{
        toolName: 'read',
        input: { path: join(TEST_DIR, 'non-existent-file.txt') },
        toolCallId: 'tc-err',
      }],
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      finishReason: 'tool-calls',
    })
    // 第二轮：LLM 看到错误后总结
    mockGenerateText.mockReturnValueOnce({
      text: '文件不存在',
      toolCalls: [],
      usage: { inputTokens: 30, outputTokens: 10, totalTokens: 40 },
      finishReason: 'stop',
    })

    const manager = new SubagentManager({
      maxConcurrent: 1,
      timeoutMs: 5000,
      blockedTools: [],
    })

    const result = await manager.spawn(
      { task: '读不存在文件' },
      {
        model: { modelId: 'mock', provider: 'mock' } as any,
        system: 'test',
        messages: [],
        cwd: TEST_DIR,
      }
    )

    expect(result.success).toBe(true)

    const secondCallArgs = mockGenerateText.mock.calls[mockGenerateText.mock.calls.length - 1][0]
    const messages = secondCallArgs.messages as Array<{ role: string; content: any[] }>
    const toolMsg = messages.find((m) => m.role === 'tool')
    expect(toolMsg).toBeDefined()
    for (const part of toolMsg!.content) {
      expect(part.type).toBe('tool-result')
      expect(part.output.type).toBe('text')
      expect(part.output.value).toMatch(/Error/)
    }
  })
})