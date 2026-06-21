import { describe, it, expect } from 'vitest'
import { redact } from '../dev-logger'

describe('redact', () => {
  it('redact 对象中的 apiKey 字段', () => {
    expect(redact({ apiKey: 'sk-xxx', name: 'foo' })).toEqual({
      apiKey: '***REDACTED***',
      name: 'foo',
    })
  })

  it('redact 嵌套对象中的 token 字段', () => {
    expect(redact({ name: 'foo', nested: { token: 'x' } })).toEqual({
      name: 'foo',
      nested: { token: '***REDACTED***' },
    })
  })

  it('redact 内联 Anthropic key', () => {
    const input = 'my key is sk-ant-api03-abc123def456ghi789jkl012mno'
    expect(redact(input)).toBe('my key is ***REDACTED***')
  })

  it('redact 内联 GitHub PAT', () => {
    const input = 'token: ghp_abcdefghijklmnopqrstuvwxyz123456'
    expect(redact(input)).toBe('token: ***REDACTED***')
  })

  it('redact Bearer token', () => {
    const input = 'Authorization: Bearer abcdefghijklmnopqrstuvwx'
    expect(redact(input)).toBe('Authorization: ***REDACTED***')
  })

  it('普通文本不变', () => {
    expect(redact('hello world')).toBe('hello world')
  })

  it('数字不变', () => {
    expect(redact(42)).toBe(42)
  })

  it('null 不变', () => {
    expect(redact(null)).toBe(null)
  })

  it('undefined 不变', () => {
    expect(redact(undefined)).toBe(undefined)
  })

  it('嵌套数组', () => {
    expect(redact([{ token: 'x' }, 42, 'plain'])).toEqual([
      { token: '***REDACTED***' },
      42,
      'plain',
    ])
  })

  it('redact password 字段', () => {
    expect(redact({ password: 'secret123' })).toEqual({
      password: '***REDACTED***',
    })
  })

  it('redact 大小写不敏感', () => {
    expect(redact({ API_KEY: 'sk-xxx' })).toEqual({ API_KEY: '***REDACTED***' })
    expect(redact({ ApiSecret: 'x' })).toEqual({ ApiSecret: '***REDACTED***' })
  })

  it('不误杀不含 key 的普通对象', () => {
    expect(redact({ name: 'foo', count: 3 })).toEqual({ name: 'foo', count: 3 })
  })
})
