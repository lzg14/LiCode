import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installSigintAbort } from '../sigint'

describe('installSigintAbort', () => {
  // 每个测试前后保存/恢复 SIGINT listener 集合，避免污染其他测试
  let savedListeners: NodeJS.EventEmitter['listeners'] extends (event: string) => infer R ? R : never

  beforeEach(() => {
    savedListeners = process.listeners('SIGINT').slice()
    process.removeAllListeners('SIGINT')
  })

  afterEach(() => {
    process.removeAllListeners('SIGINT')
    for (const l of savedListeners as unknown as NodeJS.SignalsListener[]) {
      process.on('SIGINT', l)
    }
  })

  it('安装后 listenerCount 增加 1', () => {
    const before = process.listenerCount('SIGINT')
    const dispose = installSigintAbort(() => {})
    try {
      expect(process.listenerCount('SIGINT')).toBe(before + 1)
    } finally {
      dispose()
    }
    expect(process.listenerCount('SIGINT')).toBe(before)
  })

  // 回归：旧实现用 removeAllListeners 会清空已有 handler。修复后必须保留它们。
  it('安装时不移除已有的 SIGINT handler', () => {
    const otherHandler = vi.fn()
    process.on('SIGINT', otherHandler)
    const before = process.listenerCount('SIGINT')

    const dispose = installSigintAbort(() => {})
    try {
      expect(process.listenerCount('SIGINT')).toBe(before + 1)
      // 已有 handler 必须在场
      expect(process.listeners('SIGINT')).toContain(otherHandler)
    } finally {
      dispose()
    }
    // dispose 只移除自己注册的 handler，已有 handler 仍在
    expect(process.listeners('SIGINT')).toContain(otherHandler)
  })

  it('dispose 后不重复移除（idempotent 安全调用）', () => {
    const dispose = installSigintAbort(() => {})
    const before = process.listenerCount('SIGINT')
    dispose()
    expect(process.listenerCount('SIGINT')).toBe(before - 1)
    // 第二次 dispose 不抛错也不变 count
    expect(() => dispose()).not.toThrow()
    expect(process.listenerCount('SIGINT')).toBe(before - 1)
  })

  it('trigger handler 时调用 abort()', () => {
    const abort = vi.fn()
    const dispose = installSigintAbort(abort)
    try {
      process.emit('SIGINT')
      expect(abort).toHaveBeenCalledTimes(1)
    } finally {
      dispose()
    }
  })
})