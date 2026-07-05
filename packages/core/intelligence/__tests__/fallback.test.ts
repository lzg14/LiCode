import { describe, expect, it } from 'vitest'
import { DefaultFallback, defaultFallback } from '../fallback'

describe('fallback', () => {
  describe('DefaultFallback', () => {
    it('forDecision() returns triggered=false empty result', () => {
      const f = new DefaultFallback()
      const r = f.forDecision('any-name')
      expect(r).toEqual({
        name: 'any-name',
        triggered: false,
        content: '',
        meta: { fallback: 'default' },
      })
    })

    it('confirmPolicy() returns "once" by default', () => {
      const f = new DefaultFallback()
      expect(f.confirmPolicy()).toBe('once')
    })

    it('defaultFallback() factory returns DefaultFallback instance', () => {
      const f = defaultFallback()
      expect(f).toBeInstanceOf(DefaultFallback)
    })
  })
})
