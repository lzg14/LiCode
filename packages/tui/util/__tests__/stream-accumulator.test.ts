import { describe, it, expect } from 'vitest'
import { createStreamAccumulator } from '../stream-accumulator'

describe('createStreamAccumulator', () => {
  it('纯文本跨多 chunk', () => {
    const acc = createStreamAccumulator()
    const r1 = acc.push('Hello ')
    expect(r1.closed).toEqual([{ kind: 'text', text: 'Hello ' }])
    expect(r1.pending).toBe('')

    const r2 = acc.push('world')
    expect(r2.closed).toEqual([{ kind: 'text', text: 'world' }])
    expect(r2.pending).toBe('')
  })

  it('thinking 完整 chunk', () => {
    const acc = createStreamAccumulator()
    const r = acc.push('<thinking>analyzing code</thinking>')
    expect(r.closed).toEqual([{ kind: 'thinking', text: 'analyzing code' }])
    expect(r.pending).toBe('')
  })

  it('<think> 完整 chunk', () => {
    const acc = createStreamAccumulator()
    const r = acc.push('<think>analyzing code</think>')
    expect(r.closed).toEqual([{ kind: 'thinking', text: 'analyzing code' }])
    expect(r.pending).toBe('')
  })

  it('thinking 跨 2 个 chunk（标签分两半）', () => {
    const acc = createStreamAccumulator()
    // 不完整的标签前缀保持 pending
    const r1 = acc.push('<thin')
    expect(r1.closed).toEqual([])
    expect(r1.pending).toBe('<thin')

    // 闭合后作为 thinking 段
    const r2 = acc.push('king>analyzing</thinking>')
    expect(r2.closed).toEqual([{ kind: 'thinking', text: 'analyzing' }])
    expect(r2.pending).toBe('')
  })

  it('<think> 跨 chunk', () => {
    const acc = createStreamAccumulator()
    // <think> 是完整开标签，进入 thinking 模式
    const r1 = acc.push('<think>')
    expect(r1.closed).toEqual([])
    expect(r1.pending).toBe('')

    const r2 = acc.push('analyzing</think>')
    expect(r2.closed).toEqual([{ kind: 'thinking', text: 'analyzing' }])
    expect(r2.pending).toBe('')
  })

  it('thinking 跨 3 个 chunk', () => {
    const acc = createStreamAccumulator()
    // <thinking> 是完整开标签，进入 thinking 模式
    const r1 = acc.push('<thinking>line1\n')
    expect(r1.closed).toEqual([])
    expect(r1.pending).toBe('line1\n')

    const r2 = acc.push('line2</thinking>')
    expect(r2.closed).toEqual([{ kind: 'thinking', text: 'line1\nline2' }])
    expect(r2.pending).toBe('')

    const r3 = acc.push('\nanswer text')
    expect(r3.closed).toEqual([{ kind: 'text', text: '\nanswer text' }])
    expect(r3.pending).toBe('')
  })

  it('system-reminder 完整 chunk', () => {
    const acc = createStreamAccumulator()
    const r = acc.push('<system-reminder>context data</system-reminder>')
    expect(r.closed).toEqual([{ kind: 'system-reminder', text: 'context data' }])
    expect(r.pending).toBe('')
  })

  it('system-reminder 跨 chunk', () => {
    const acc = createStreamAccumulator()
    const r1 = acc.push('<system-rem')
    expect(r1.closed).toEqual([])
    expect(r1.pending).toBe('<system-rem')

    const r2 = acc.push('inder>data</system-reminder>')
    expect(r2.closed).toEqual([{ kind: 'system-reminder', text: 'data' }])
    expect(r2.pending).toBe('')
  })

  it('thinking 后接正文', () => {
    const acc = createStreamAccumulator()
    const r1 = acc.push('<thinking>plan</thinking>')
    expect(r1.closed).toEqual([{ kind: 'thinking', text: 'plan' }])
    expect(r1.pending).toBe('')

    const r2 = acc.push('Here is the answer')
    expect(r2.closed).toEqual([{ kind: 'text', text: 'Here is the answer' }])
    expect(r2.pending).toBe('')
  })

  it('多个 thinking 连续', () => {
    const acc = createStreamAccumulator()
    const r1 = acc.push('<thinking>first</thinking>')
    expect(r1.closed).toEqual([{ kind: 'thinking', text: 'first' }])

    const r2 = acc.push('<thinking>second</thinking>')
    expect(r2.closed).toEqual([{ kind: 'thinking', text: 'second' }])
  })

  it('混合内容：thinking + system-reminder + text', () => {
    const acc = createStreamAccumulator()
    const r = acc.push('<thinking>plan</thinking><system-reminder>ctx</system-reminder>answer')
    expect(r.closed).toEqual([
      { kind: 'thinking', text: 'plan' },
      { kind: 'system-reminder', text: 'ctx' },
      { kind: 'text', text: 'answer' },
    ])
    expect(r.pending).toBe('')
  })

  it('reset 清空状态', () => {
    const acc = createStreamAccumulator()
    acc.push('<thinking>partial')
    acc.reset()
    const r = acc.push('new text')
    expect(r.closed).toEqual([{ kind: 'text', text: 'new text' }])
    expect(r.pending).toBe('')
  })

  it('未闭合的正文（LLM 输出到一半）', () => {
    const acc = createStreamAccumulator()
    const r = acc.push('partial text...')
    expect(r.closed).toEqual([{ kind: 'text', text: 'partial text...' }])
    expect(r.pending).toBe('')
  })

  it('thinking 内容为空', () => {
    const acc = createStreamAccumulator()
    const r = acc.push('<thinking></thinking>')
    expect(r.closed).toEqual([{ kind: 'thinking', text: '' }])
    expect(r.pending).toBe('')
  })

  it('混合格式：一个 thinking 一个 <think>', () => {
    const acc = createStreamAccumulator()
    const r = acc.push('<thinking>first</thinking><think>second</think>')
    expect(r.closed).toEqual([
      { kind: 'thinking', text: 'first' },
      { kind: 'thinking', text: 'second' },
    ])
  })

  it('文本后接不完整的 thinking 标签', () => {
    const acc = createStreamAccumulator()
    // <thin 是不完整的标签前缀，整个 buffer 保持 pending
    const r1 = acc.push('text before <thin')
    expect(r1.closed).toEqual([])
    expect(r1.pending).toBe('text before <thin')

    const r2 = acc.push('king>content</thinking> after')
    expect(r2.closed).toEqual([
      { kind: 'text', text: 'text before ' },
      { kind: 'thinking', text: 'content' },
      { kind: 'text', text: ' after' },
    ])
    expect(r2.pending).toBe('')
  })
})
