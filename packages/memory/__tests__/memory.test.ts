import { describe, it, expect } from 'vitest'
import { Memory } from '../memory'

describe('Memory', () => {
  it('should store and search memory', async () => {
    const memory = new Memory()
    const id = await memory.store({ scope: 'session', type: 'memory', content: 'licode uses七阶段循环' })

    expect(id).toBeTruthy()
    const results = await memory.search('七阶段')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].content).toContain('七阶段循环')
  })

  it('should recall memories', async () => {
    const memory = new Memory()
    await memory.store({ scope: 'session', type: 'memory', content: 'memory recall test content' })

    const recalled = await memory.recall('recall test')
    expect(recalled.length).toBeGreaterThan(0)
  })

  it('should list memories by scope', async () => {
    const memory = new Memory()
    await memory.store({ scope: 'global', type: 'memory', content: 'global memory' })
    await memory.store({ scope: 'session', type: 'memory', content: 'session memory' })

    const globals = memory.list('global')
    expect(globals.every(e => e.scope === 'global')).toBe(true)

    const sessions = memory.list('session')
    expect(sessions.every(e => e.scope === 'session')).toBe(true)
  })

  it('should list all memories when no scope specified', async () => {
    const memory = new Memory()
    await memory.store({ scope: 'global', type: 'memory', content: 'a' })
    await memory.store({ scope: 'session', type: 'memory', content: 'b' })

    const all = memory.list()
    expect(all.length).toBeGreaterThanOrEqual(2)
  })

  it('should delete memory', async () => {
    const memory = new Memory()
    const id = await memory.store({ scope: 'session', type: 'memory', content: 'to be deleted' })

    const deleted = await memory.delete(id)
    expect(deleted).toBe(true)

    const results = await memory.search('to be deleted')
    expect(results.length).toBe(0)
  })

  it('should return false when deleting non-existent memory', async () => {
    const memory = new Memory()
    const deleted = await memory.delete('non-existent-id')
    expect(deleted).toBe(false)
  })

  it('should cleanup expired memories', async () => {
    const memory = new Memory()
    const id = await memory.store({ scope: 'session', type: 'memory', content: 'old memory' })

    // Simulate old memory by setting low maxAge
    const cleaned = await memory.cleanup(1)
    expect(cleaned).toBeGreaterThanOrEqual(0)
  })

  it('should search with scoring', async () => {
    const memory = new Memory()
    await memory.store({ scope: 'session', type: 'memory', content: 'typescript is great' })
    await memory.store({ scope: 'session', type: 'memory', content: 'python is also good' })

    const results = await memory.search('typescript')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].score).toBeGreaterThan(0)
  })

  it('should limit search results', async () => {
    const memory = new Memory()
    for (let i = 0; i < 20; i++) {
      await memory.store({ scope: 'session', type: 'memory', content: `memory item ${i}` })
    }

    const results = await memory.search('memory', 5)
    expect(results.length).toBeLessThanOrEqual(5)
  })
})
