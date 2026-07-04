import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { type ExecuteContext, execute } from '../phases/execute'
import { makeMockLanguageModel } from './helpers/mock-model'

// 确保工具已注册（导入 builtin 会注册）
import '../../tools/builtin'

const TEST_DIR = join(tmpdir(), `licode-e2e-test-${Date.now()}`)

// Mock generateText / streamText 来模拟 LLM
// 通过 globalThis + vi.mock 避开 bun test runner 下 vi.hoisted 缺失的兼容问题
vi.mock('ai', () => ({
  generateText: (...args: any[]) => (globalThis as any).__mockGenerateText__?.(...args),
  streamText: (...args: any[]) => (globalThis as any).__mockStreamText__?.(...args),
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
  text: Promise.resolve(text),
  toolCalls: Promise.resolve(toolCalls),
  toolResults: Promise.resolve([]),
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
    delete (globalThis as any).__mockStreamTextImpl__
    delete (globalThis as any).__mockGenerateTextImpl__
  })

  it('LLM 返回纯文本 — 直接输出', async () => {
    ;(globalThis as any).__mockStreamText__ = () => streamTextResponse('直接回复')

    const ctx: ExecuteContext = {
      model: makeMockLanguageModel(),
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
    let callIdx = 0
    const responses = [
      streamTextResponse('I will read the file', [
        { toolName: 'read', input: { path: join(TEST_DIR, 'test.txt') }, toolCallId: 'tc1' },
      ]),
      streamTextResponse('Here is the file content: mock file content'),
    ]
    ;(globalThis as any).__mockStreamText__ = () => responses[callIdx++]

    const ctx: ExecuteContext = {
      model: makeMockLanguageModel(),
      userInput: '请读取 test.txt',
      cwd: TEST_DIR,
      history: [{ role: 'user', content: [{ type: 'text', text: '请读取 test.txt' }] }],
    }
    const result = await execute(ctx)
    // 修复后：tool-call 后的最终纯文本必须 return，不能 return ''
    expect(result).toBe('Here is the file content: mock file content')
    expect(callIdx).toBe(2)
  })
})
