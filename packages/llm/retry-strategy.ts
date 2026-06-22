export type RetryCategory = 'auth' | 'rateLimit' | 'server' | 'network' | 'unknown'

export interface RetryStrategy {
  shouldRetry: (attempt: number) => boolean
  delayMs: (attempt: number) => number
  message: string
}

const strategies: Record<string, RetryStrategy> = {
  auth: {
    shouldRetry: () => false,
    delayMs: () => 0,
    message: 'API Key 无效或已过期，请检查环境变量',
  },
  rateLimit: {
    shouldRetry: (n) => n < 3,
    delayMs: (n) => 2 ** n * 1000,
    message: 'API 限流，将在 {delay}秒后重试',
  },
  server: {
    shouldRetry: (n) => n < 3,
    delayMs: (n) => Math.min(2 ** n, 30) * 1000,
    message: 'Provider 服务暂时不可用',
  },
  network: {
    shouldRetry: (n) => n < 3,
    delayMs: (n) => (n + 1) * 1000,
    message: '网络连接失败，将在 {delay}秒后重试',
  },
  unknown: {
    shouldRetry: () => false,
    delayMs: () => 0,
    message: '未知错误: {error}',
  },
}

export function classifyError(error: unknown): RetryCategory {
  const msg = String(error)
  const lower = msg.toLowerCase()

  if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('auth') || lower.includes('api key')) {
    return 'auth'
  }
  if (lower.includes('429') || lower.includes('rate limit') || lower.includes('too many requests')) {
    return 'rateLimit'
  }
  if (lower.includes('500') || lower.includes('502') || lower.includes('503') || lower.includes('service unavailable') || lower.includes('server error')) {
    return 'server'
  }
  if (lower.includes('econnrefused') || lower.includes('enotfound') || lower.includes('timeout') || lower.includes('network') || lower.includes('fetch failed')) {
    return 'network'
  }

  return 'unknown'
}

export function getRetryStrategy(category: RetryCategory): RetryStrategy {
  return strategies[category] ?? strategies.unknown
}

export function formatRetryMessage(category: RetryCategory, error: unknown, attempt?: number): string {
  const strategy = getRetryStrategy(category)
  const delay = attempt !== undefined ? strategy.delayMs(attempt) / 1000 : 0
  return strategy.message
    .replace('{delay}', String(Math.round(delay)))
    .replace('{error}', String(error))
}

export async function waitAndRetry(
  category: RetryCategory,
  attempt: number,
  error: unknown,
): Promise<boolean> {
  const strategy = getRetryStrategy(category)
  if (!strategy.shouldRetry(attempt)) return false

  const delay = strategy.delayMs(attempt)
  await new Promise(resolve => setTimeout(resolve, delay))
  return true
}
