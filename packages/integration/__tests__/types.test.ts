import { describe, it, expect, vi } from 'vitest'
import { BaseIntegration } from '../types'

class TestIntegration extends BaseIntegration {
  name = 'test'
  async connect() { this.enabled = true }
  async disconnect() { this.enabled = false }
  async health() { return { healthy: true } }
}

describe('Types + BaseIntegration', () => {
  it('BaseIntegration 抽象类结构与属性完整', () => {
    const i = new TestIntegration()
    expect(i.name).toBe('test')
    expect(i.enabled).toBe(false)
    expect(typeof i.connect).toBe('function')
    expect(typeof i.disconnect).toBe('function')
    expect(typeof i.health).toBe('function')
  })

  it('withConnection 在 disabled 时抛出', async () => {
    const i = new TestIntegration()
    i.enabled = false
    await expect(i.withConnection(async () => 'x')).rejects.toThrow('is not connected')
  })

  it('withConnection 在 enabled 时执行并返回结果', async () => {
    const i = new TestIntegration()
    i.enabled = true
    expect(await i.withConnection(async () => 42)).toBe(42)
  })
})
