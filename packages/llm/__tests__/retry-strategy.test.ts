import { describe, it, expect } from 'vitest'
import {
  classifyError,
  getRetryStrategy,
  formatRetryMessage,
  waitAndRetry,
  type RetryCategory,
} from '../retry-strategy'

describe('classifyError', () => {
  it('401 分类为 auth', () => {
    expect(classifyError(new Error('401 Unauthorized'))).toBe('auth')
  })

  it('api key 相关分类为 auth', () => {
    expect(classifyError('Invalid API Key')).toBe('auth')
  })

  it('unauthorized 分类为 auth', () => {
    expect(classifyError('Unauthorized')).toBe('auth')
  })

  it('429 分类为 rateLimit', () => {
    expect(classifyError('429 Too Many Requests')).toBe('rateLimit')
  })

  it('rate limit 文本分类为 rateLimit', () => {
    expect(classifyError('rate limit exceeded')).toBe('rateLimit')
  })

  it('500 分类为 server', () => {
    expect(classifyError('500 Internal Server Error')).toBe('server')
  })

  it('503 分类为 server', () => {
    expect(classifyError('503 Service Unavailable')).toBe('server')
  })

  it('ECONNREFUSED 分类为 network', () => {
    expect(classifyError('connect ECONNREFUSED')).toBe('network')
  })

  it('timeout 分类为 network', () => {
    expect(classifyError('timeout exceeded')).toBe('network')
  })

  it('fetch failed 分类为 network', () => {
    expect(classifyError('fetch failed')).toBe('network')
  })

  it('未知错误分类为 unknown', () => {
    expect(classifyError('some random error')).toBe('unknown')
  })
})

describe('getRetryStrategy', () => {
  it('auth 策略不应重试', () => {
    const s = getRetryStrategy('auth')
    expect(s.shouldRetry(0)).toBe(false)
    expect(s.delayMs(0)).toBe(0)
  })

  it('rateLimit 策略支持重试', () => {
    const s = getRetryStrategy('rateLimit')
    expect(s.shouldRetry(0)).toBe(true)
    expect(s.shouldRetry(2)).toBe(true)
    expect(s.shouldRetry(3)).toBe(false)
  })

  it('server 策略延迟指数退避不超过30秒', () => {
    const s = getRetryStrategy('server')
    expect(s.delayMs(0)).toBe(1000)
    expect(s.delayMs(4)).toBe(16000)
    expect(s.delayMs(5)).toBe(30000)
  })

  it('network 策略线性递增', () => {
    const s = getRetryStrategy('network')
    expect(s.delayMs(0)).toBe(1000)
    expect(s.delayMs(1)).toBe(2000)
    expect(s.delayMs(2)).toBe(3000)
  })

  it('unknown 策略不应重试', () => {
    const s = getRetryStrategy('unknown')
    expect(s.shouldRetry(0)).toBe(false)
  })
})

describe('formatRetryMessage', () => {
  it('auth 错误给出友好提示', () => {
    const msg = formatRetryMessage('auth', '401 Unauthorized')
    expect(msg).toContain('API Key')
  })

  it('rateLimit 错误包含延迟时间', () => {
    const msg = formatRetryMessage('rateLimit', '429', 0)
    expect(msg).toContain('限流')
    expect(msg).toContain('1秒')
  })

  it('server 错误友好提示', () => {
    const msg = formatRetryMessage('server', '500')
    expect(msg).toContain('服务暂时不可用')
  })

  it('network 错误包含延迟时间和原始错误', () => {
    const msg = formatRetryMessage('network', 'ENOTFOUND', 0)
    expect(msg).toContain('网络连接失败')
  })
})

describe('waitAndRetry', () => {
  it('auth 错误返回 false', async () => {
    const result = await waitAndRetry('auth', 0, '401')
    expect(result).toBe(false)
  })

  it('rateLimit 错误第一次返回 true', async () => {
    const result = await waitAndRetry('rateLimit', 0, '429')
    expect(result).toBe(true)
  })

  it('rateLimit 超过重试次数返回 false', async () => {
    const result = await waitAndRetry('rateLimit', 3, '429')
    expect(result).toBe(false)
  })
})
