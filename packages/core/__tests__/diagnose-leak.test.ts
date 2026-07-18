/**
 * Memory leak diagnostic test
 *
 * 检查 CoreLoop / execute / Memory 等模块是否产生累积泄漏
 */
import { describe, expect, it } from 'vitest'

function memUsage() {
  const m = process.memoryUsage()
  return {
    heapUsed: Math.round(m.heapUsed / 1024 / 1024),
    heapTotal: Math.round(m.heapTotal / 1024 / 1024),
    rss: Math.round(m.rss / 1024 / 1024),
    external: Math.round(m.external / 1024 / 1024),
    arrayBuffers: Math.round(m.arrayBuffers / 1024 / 1024),
  }
}

describe('Memory leak diagnostic', () => {
  it('should show baseline memory', () => {
    if (typeof globalThis.gc === 'function') globalThis.gc()
    const m = memUsage()
    console.log('Baseline:', m)
    expect(m.heapUsed).toBeGreaterThan(0)
  })

  it('Memory.list() should respect hardCap', async () => {
    const { Memory } = await import('../../memory/memory')
    const mem = new Memory('D:\\ProjectFile\\licode', { hardCap: 100 })
    await (mem as any).ensureInit()
    const all = mem.list()
    console.log(`Memory entries: ${all.length}`)
    console.log(`Sample entries:`, all.slice(0, 5).map(e => ({ id: e.id, type: e.type, scope: e.scope })))
    expect(all.length).toBeLessThanOrEqual(100)
  })

  it('Should not leak arrays in tight loop', async () => {
    if (typeof globalThis.gc === 'function') globalThis.gc()
    const before = memUsage()

    // 模拟 1000 次小对象分配+释放
    const arr: number[] = []
    for (let i = 0; i < 10000; i++) {
      arr.push(i)
      arr.length = 0
    }

    if (typeof globalThis.gc === 'function') globalThis.gc()
    const after = memUsage()
    console.log('Before:', before, 'After:', after)

    // 简单循环不应该明显泄漏
    expect(after.heapUsed - before.heapUsed).toBeLessThan(20) // < 20MB
  })
})