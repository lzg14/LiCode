import { describe, it, expect } from 'vitest'
import { z } from 'zod/v4'
import { formatConfigError } from '../format-error'

const TestSchema = z.object({
  provider: z.enum(['anthropic', 'openai', 'deepseek']),
  model: z.string().min(1),
  apiKey: z.string().optional(),
})

describe('formatConfigError', () => {
  it('invalid_value: 提供友好提示列出允许值', () => {
    const result = TestSchema.safeParse({ provider: 'deepseek-v4' })
    expect(result.success).toBe(false)
    const msg = formatConfigError(result.error!)
    expect(msg).toContain('配置错误')
    expect(msg).toContain('必须是以下之一')
    expect(msg).toContain('anthropic')
  })

  it('invalid_type: 期望类型不匹配', () => {
    const result = TestSchema.safeParse({ provider: 'anthropic', model: 42 })
    expect(result.success).toBe(false)
    const msg = formatConfigError(result.error!)
    expect(msg).toContain('配置错误')
    expect(msg).toContain('期望类型 string')
  })

  it('invalid_format: 格式错误', () => {
    const schema = z.object({ email: z.string().email() })
    const result = schema.safeParse({ email: 'x' })
    expect(result.success).toBe(false)
    const msg = formatConfigError(result.error!)
    expect(msg).toContain('格式无效')
  })

  it('多个错误同时展示', () => {
    const result = TestSchema.safeParse({ provider: 'invalid', model: '' })
    expect(result.success).toBe(false)
    const msg = formatConfigError(result.error!)
    const lines = msg.split('\n')
    expect(lines.length).toBeGreaterThanOrEqual(2)
  })
})
