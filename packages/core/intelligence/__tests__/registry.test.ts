import { describe, expect, it } from 'vitest'
import { DecisionRegistry } from '../registry'
import type { DecisionResult } from '../types'

describe('DecisionRegistry', () => {
  it('registers and retrieves handler by name', () => {
    const r = new DecisionRegistry()
    const handler = () => ({ name: 'test', triggered: true, content: 'ok' } as DecisionResult)
    r.register('test', handler)
    expect(r.get('test')).toBe(handler)
  })

  it('returns undefined for unknown name', () => {
    const r = new DecisionRegistry()
    expect(r.get('nope')).toBeUndefined()
  })

  it('list() returns names in insertion order', () => {
    const r = new DecisionRegistry()
    r.register('a', () => ({ name: 'a', triggered: false, content: '' }))
    r.register('b', () => ({ name: 'b', triggered: false, content: '' }))
    r.register('c', () => ({ name: 'c', triggered: false, content: '' }))
    expect(r.list()).toEqual(['a', 'b', 'c'])
  })

  it('size() reflects registered count', () => {
    const r = new DecisionRegistry()
    expect(r.size()).toBe(0)
    r.register('x', () => ({ name: 'x', triggered: false, content: '' }))
    expect(r.size()).toBe(1)
  })

  it('re-registering same name overwrites', () => {
    const r = new DecisionRegistry()
    const h1 = () => ({ name: 'x', triggered: false, content: 'v1' })
    const h2 = () => ({ name: 'x', triggered: false, content: 'v2' })
    r.register('x', h1)
    r.register('x', h2)
    expect(r.size()).toBe(1)
    expect(r.get('x')).toBe(h2)
  })

  it('unregister() removes handler', () => {
    const r = new DecisionRegistry()
    r.register('x', () => ({ name: 'x', triggered: false, content: '' }))
    expect(r.unregister('x')).toBe(true)
    expect(r.get('x')).toBeUndefined()
  })

  it('unregister() returns false for unknown name', () => {
    const r = new DecisionRegistry()
    expect(r.unregister('nope')).toBe(false)
  })

  it('clear() removes all', () => {
    const r = new DecisionRegistry()
    r.register('a', () => ({ name: 'a', triggered: false, content: '' }))
    r.register('b', () => ({ name: 'b', triggered: false, content: '' }))
    r.clear()
    expect(r.size()).toBe(0)
    expect(r.list()).toEqual([])
  })
})
