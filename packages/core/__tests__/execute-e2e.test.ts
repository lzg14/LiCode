import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { execute, type ExecuteContext } from '../phases/execute'
import { globalToolRegistry } from '../../tools/registry'
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// 确保工具已注册（导入 builtin 会注册）
import '../../tools/builtin'

const TEST_DIR = join(tmpdir(), `licode-e2e-test-${Date.now()}`)

// Mock generateText 来模拟 LLM
// 必须在 import execute 之前，vitest 会 hoist 到文件顶部
const mockGenerateText = vi.hoisted(() => vi.fn())
vi.mock('ai', () => ({
  generateText: mockGenerateText,
  tool: (def: any) => def,
  jsonSchema: (schema: any) => schema,
}))

beforeAll(() => {
  if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true })
  writeFileSync(join(TEST_DIR, 'test.txt'), 'mock file content', 'utf-8')
})

afterAll(() => {
  vi.restoreAllMocks()
  try {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
  } catch {}
})

describe('execute E2E', () => {
  it('LLM 返回纯文本 — 直接输出', async () => {
    mockGenerateText.mockReturnValueOnce({
      text: '直接回复',
      toolCalls: [],
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      finishReason: 'stop',
    })

    const ctx: ExecuteContext = {
      model: { modelId: 'mock-model', provider: 'mock-provider' },
      userInput: 'hello',
      cwd: TEST_DIR,
      history: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    }
    const result = await execute(ctx)
    expect(result).toBe('直接回复')
  })

  it('无 model 时返回配置提示', async () => {
    const ctx = {
      userInput: 'hello',
      history: [],
    } as any
    const result = await execute(ctx)
    expect(result).toBe('请配置 LLM provider')
  })

  it('LLM 返回 tool-call → 执行工具 → 继续 → 最终返回文本', async () => {
    mockGenerateText
      .mockReturnValueOnce({
        text: 'I will read the file',
        toolCalls: [{ toolName: 'read', input: { path: join(TEST_DIR, 'test.txt') }, toolCallId: 'tc1' }],
        usage: { inputTokens: 50, outputTokens: 20, totalTokens: 70 },
        finishReason: 'tool-calls',
      })
      .mockReturnValueOnce({
        text: 'Here is the file content: mock file content',
        toolCalls: [],
        usage: { inputTokens: 30, outputTokens: 10, totalTokens: 40 },
        finishReason: 'stop',
      })

    const ctx: ExecuteContext = {
      model: { modelId: 'mock-model', provider: 'mock-provider' },
      userInput: '请读取 test.txt',
      cwd: TEST_DIR,
      history: [{ role: 'user', content: [{ type: 'text', text: '请读取 test.txt' }] }],
    }
    const result = await execute(ctx)
    // 有工具调用时最终返回空（文本通过 onIntermediateText 保存）
    expect(result).toBe('')
  })
})
