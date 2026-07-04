import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { execute, type ExecuteContext } from '../phases/execute'
import { globalToolRegistry } from '../../tools/registry'
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// 确保工具已注册（导入 builtin 会注册）
import '../../tools/builtin'

const TEST_DIR = join(tmpdir(), `licode-e2e-test-${Date.now()}`)

// Mock generateText / streamText 来模拟 LLM
// 必须在 import execute 之前，vitest 会 hoist 到文件顶部
const mockGenerateText = vi.hoisted(() => vi.fn())
const mockStreamText = vi.hoisted(() => vi.fn())
vi.mock('ai', () => ({
  generateText: mockGenerateText,
  streamText: mockStreamText,
  tool: (def: any) => def,
  jsonSchema: (schema: any) => schema,
}))

// 让 streamText 返回一个看起来像真实 streamText 的对象
// execute.ts 会消费 fullStream（async iterable）+ usage（promise）+ finishReason（promise）
const streamTextResponse = (text: string, toolCalls: any[] = []) => ({
  fullStream: (async function* () {
    if (text) yield { type: 'text-delta', text }
    for (const tc of toolCalls) yield { type: 'tool-call', ...tc }
  })(),
  usage: Promise.resolve({ inputTokens: 10, outputTokens: 5, totalTokens: 15 }),
  finishReason: Promise.resolve(toolCalls.length > 0 ? 'tool-calls' : 'stop'),
})

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
  beforeEach(() => {
    mockGenerateText.mockReset()
    mockStreamText.mockReset()
  })

  it('LLM 返回纯文本 — 直接输出', async () => {
    mockStreamText.mockReturnValueOnce(streamTextResponse('直接回复'))

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
    mockStreamText
      .mockReturnValueOnce(streamTextResponse('I will read the file', [
        { toolName: 'read', input: { path: join(TEST_DIR, 'test.txt') }, toolCallId: 'tc1' },
      ]))
      .mockReturnValueOnce(streamTextResponse('Here is the file content: mock file content'))

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
