import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { type ExecuteContext, execute } from '../phases/execute'
import { makeMockLanguageModel } from './helpers/mock-model'

// 必须先 import builtin，registerBuiltinTools
import '../../tools/builtin'

const TEST_DIR = join(tmpdir(), `licode-stream-error-test-${Date.now()}`)

// mock module —— 在 import ai 之前替换
vi.mock('ai', () => {
  return {
    generateText: (...args: any[]) => (globalThis as any).__mockGenerateText__?.(...args),
    streamText: (...args: any[]) => (globalThis as any).__mockStreamText__?.(...args),
    tool: (def: any) => def,
    jsonSchema: (schema: any) => schema,
  }
})

const _mockStreamText = (...args: any[]) => (globalThis as any).__mockStreamTextImpl__?.(...args)
;(globalThis as any).__mockStreamText__ = (...args: any[]) => (globalThis as any).__mockStreamTextImpl__?.(...args)

beforeAll(() => {
  if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true })
  writeFileSync(join(TEST_DIR, 'stream-error.txt'), 'content from disk', 'utf-8')
})

afterAll(() => {
  vi.restoreAllMocks()
  try {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
  } catch {}
})

/**
 * 模拟 AI SDK v6 的 streamText result 在 Bun + 全双工 stream 下的 bug：
 * fullStream AsyncIterable 在消费过程中抛 TypeError（pipeThrough 不可用）。
 * 这种情况下，streamedToolCalls 收集会失败 → resolvedResult.toolCalls 是空。
 * 修复后应改用 await streamResult.toolCalls / .text / .finishReason promise 路径。
 */
const streamTextResultWithPipeThroughBug = (text: string, toolCalls: any[]) => {
  const fullStream = (async function* () {
    yield { type: 'text-delta', text: text.slice(0, 2) }
    throw new TypeError("generatorStream.pipeThrough is not a function. (In 'generatorStream.pipeThrough(forwardStream)', 'generatorStream.pipeThrough' is undefined)")
  })()
  return {
    // textStream 正常 emit text chunk — execute 改用 textStream 后正常路径能拿到 text
    textStream: (async function* () {
      yield text
    })(),
    fullStream,
    text: Promise.resolve(text),
    toolCalls: Promise.resolve(toolCalls),
    toolResults: Promise.resolve([]),
    finishReason: Promise.resolve(toolCalls.length > 0 ? 'tool-calls' : 'stop'),
    usage: Promise.resolve({ inputTokens: 10, outputTokens: 5, totalTokens: 15 }),
  }
}

const streamTextResultNormal = (text: string, toolCalls: any[] = []) => ({
  textStream: (async function* () {
    if (text) yield text
  })(),
  fullStream: (async function* () {
    if (text) yield { type: 'text-delta', text }
    for (const tc of toolCalls) yield { type: 'tool-call', ...tc }
  })(),
  text: Promise.resolve(text),
  toolCalls: Promise.resolve(toolCalls),
  toolResults: Promise.resolve([]),
  finishReason: Promise.resolve(toolCalls.length > 0 ? 'tool-calls' : 'stop'),
  usage: Promise.resolve({ inputTokens: 20, outputTokens: 10, totalTokens: 30 }),
})

describe('execute - stream pipeThrough 抛错时不应丢 tool-call', () => {
  beforeEach(() => {
    delete (globalThis as any).__mockStreamTextImpl__
  })

  it('LLM 返回 tool-call，fullStream pipeThrough 抛错，工具仍应被执行', async () => {
    let callIdx = 0
    const responses = [
      streamTextResultWithPipeThroughBug(
        '我先读一下文件',
        [{ toolName: 'read', input: { path: join(TEST_DIR, 'stream-error.txt') }, toolCallId: 'tc1' }],
      ),
      streamTextResultNormal('读完了，文件内容是: content from disk'),
    ]
    ;(globalThis as any).__mockStreamTextImpl__ = () => responses[callIdx++]

    const ctx: ExecuteContext = {
      model: makeMockLanguageModel(),
      userInput: '读取 stream-error.txt',
      cwd: TEST_DIR,
      history: [{ role: 'user', content: [{ type: 'text', text: '读取 stream-error.txt' }] }],
    }

    const result = await execute(ctx)

    // 关键断言：stream 解析失败不应让 tool-call 丢
    // 工具被执行后，最终回复是 "读完了..." 而不是空或异常
    expect(result).toBe('读完了，文件内容是: content from disk')
    expect(callIdx).toBe(2) // 调了 2 次：第一次 tool-call，第二次纯文本回复
  })

  it('纯文本回复且 fullStream pipeThrough 抛错时，不应崩，应能拿到文本', async () => {
    ;(globalThis as any).__mockStreamTextImpl__ = () =>
      streamTextResultWithPipeThroughBug('纯文本回复', [])

    const ctx: ExecuteContext = {
      model: makeMockLanguageModel(),
      userInput: 'hi',
      cwd: TEST_DIR,
      history: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    }

    const result = await execute(ctx)
    expect(result).toBe('纯文本回复')
  })
})
