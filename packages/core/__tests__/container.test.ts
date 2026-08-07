import { describe, expect, it } from 'vitest'
import { Container } from '../container'

describe('Container', () => {
  it('resolve 返回注册的实例', () => {
    const c = new Container()
    c.register('value', () => 42)
    expect(c.resolve<number>('value')).toBe(42)
  })

  it('单例：多次 resolve 返回同一实例', () => {
    const c = new Container()
    let count = 0
    c.register('obj', () => ({ id: count++ }))
    const a = c.resolve('obj')
    const b = c.resolve('obj')
    expect(a).toBe(b)
    expect((a as { id: number }).id).toBe(0)
  })

  it('工厂惰性执行，resolve 前不调用', () => {
    const c = new Container()
    let called = false
    c.register('lazy', () => { called = true; return 1 })
    expect(called).toBe(false)
    c.resolve('lazy')
    expect(called).toBe(true)
  })

  it('未注册的 key 抛错', () => {
    const c = new Container()
    expect(() => c.resolve('missing')).toThrow(/not registered/)
  })

  it('has 判断是否已注册', () => {
    const c = new Container()
    expect(c.has('x')).toBe(false)
    c.register('x', () => 1)
    expect(c.has('x')).toBe(true)
  })

  it('支持覆盖同 key 注册（测试替换服务）', () => {
    const c = new Container()
    c.register('svc', () => 'real')
    expect(c.resolve('svc')).toBe('real')
    c.register('svc', () => 'mock')
    expect(c.resolve('svc')).toBe('mock')
  })
})