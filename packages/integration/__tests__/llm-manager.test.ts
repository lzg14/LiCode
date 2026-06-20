import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../llm/anthropic', () => ({ AnthropicProvider: vi.fn() }))
vi.mock('../../llm/openai', () => ({ OpenAIProvider: vi.fn() }))

import { LLMManager } from '../llm-manager'
import { AnthropicProvider } from '../../llm/anthropic'
import { OpenAIProvider } from '../../llm/openai'

describe('LLMManager', () => {
  let m: LLMManager

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(AnthropicProvider).mockImplementation(() => ({ name: 'anthropic', complete: vi.fn() }))
    vi.mocked(OpenAIProvider).mockImplementation(() => ({ name: 'openai', complete: vi.fn() }))
    m = new LLMManager()
  })

  it('register 存储 provider 配置', () => {
    m.register({ name: 't', provider: 'anthropic', model: 'c3', apiKey: 'k', priority: 1 })
    expect(m.list()).toHaveLength(1)
    expect(m.list()[0].name).toBe('t')
  })

  it('register 支持 openai', () => {
    m.register({ name: 'o1', provider: 'openai', model: 'gpt4', apiKey: 'k', priority: 1 })
    expect(m.list()[0].provider).toBe('openai')
  })

  it('register 不支持的 provider 抛出', () => {
    expect(() => m.register({ name: 'b', provider: 'local' as any, model: 'x', priority: 1 })).toThrow('Unsupported')
  })

  it('get 按名称返回 provider', () => {
    m.register({ name: 'llm', provider: 'anthropic', model: 'c3', apiKey: 'k', priority: 1 })
    const p = m.get('llm')
    expect(p).toBeDefined()
    expect(p!.name).toBe('anthropic')
  })

  it('get 无参返回默认', () => {
    m.register({ name: 'd', provider: 'anthropic', model: 'c3', apiKey: 'k', priority: 1 })
    expect(m.get()).toBeDefined()
  })

  it('get 无 provider 时返回 undefined', () => {
    expect(m.get()).toBeUndefined()
    expect(m.get('none')).toBeUndefined()
  })

  it('getDefault 返回最高优先级', () => {
    m.register({ name: 'low', provider: 'anthropic', model: 'c', apiKey: 'k', priority: 1 })
    m.register({ name: 'high', provider: 'openai', model: 'g', apiKey: 'k', priority: 10 })
    expect(m.getDefault()!.name).toBe('openai')
  })

  it('list 返回所有配置', () => {
    m.register({ name: 'a', provider: 'anthropic', model: 'c', apiKey: 'k', priority: 1 })
    m.register({ name: 'b', provider: 'openai', model: 'g', apiKey: 'k', priority: 2 })
    expect(m.list()).toHaveLength(2)
  })

  it('complete 调用 provider 的 complete', async () => {
    const mc = vi.fn().mockResolvedValue({ content: 'hello' })
    vi.mocked(AnthropicProvider).mockImplementation(() => ({ name: 'a', complete: mc }))
    m.register({ name: 'llm', provider: 'anthropic', model: 'c', apiKey: 'k', priority: 1 })
    const r = await m.complete({ model: 'c', messages: [{ role: 'user', content: 'hi' }] })
    expect(r.content).toBe('hello')
  })

  it('complete 无 provider 抛出', async () => {
    await expect(m.complete({ model: 'x', messages: [] })).rejects.toThrow('No LLM provider available')
  })
})
