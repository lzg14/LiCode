import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Scheduler } from '../scheduler'

describe('Scheduler', () => {
  let scheduler: Scheduler
  let onTrigger: ReturnType<typeof vi.fn>
  let onLog: ReturnType<typeof vi.fn>

  beforeEach(() => {
    onTrigger = vi.fn().mockResolvedValue(undefined)
    onLog = vi.fn()
    scheduler = new Scheduler({ onTrigger, onLog })
  })

  afterEach(() => {
    scheduler.deleteAll()
  })

  it('parseInterval 解析各种格式', () => {
    expect(scheduler.parseInterval('5m')).toBe(5 * 60 * 1000)
    expect(scheduler.parseInterval('30s')).toBe(30 * 1000)
    expect(scheduler.parseInterval('2h')).toBe(2 * 60 * 60 * 1000)
    expect(scheduler.parseInterval('1d')).toBe(24 * 60 * 60 * 1000)
    expect(scheduler.parseInterval('abc')).toBeNull()
    expect(scheduler.parseInterval('5x')).toBeNull()
    expect(scheduler.parseInterval('')).toBeNull()
  })

  it('create 创建任务', () => {
    const id = scheduler.create(60_000, 'test prompt')
    expect(id).toBeTruthy()
    expect(scheduler.list()).toHaveLength(1)
    const task = scheduler.list()[0]
    expect(task.prompt).toBe('test prompt')
    expect(task.intervalMs).toBe(60_000)
  })

  it('delete 取消任务', () => {
    const id = scheduler.create(60_000, 'test')
    expect(scheduler.delete(id)).toBe(true)
    expect(scheduler.list()).toHaveLength(0)
  })

  it('delete 不存在的 id 返回 false', () => {
    expect(scheduler.delete('nonexistent')).toBe(false)
  })

  it('deleteAll 清空所有任务', () => {
    scheduler.create(60_000, 'a')
    scheduler.create(60_000, 'b')
    expect(scheduler.deleteAll()).toBe(2)
    expect(scheduler.list()).toHaveLength(0)
  })

  it('hasTasks 判断是否有任务', () => {
    expect(scheduler.hasTasks()).toBe(false)
    const id = scheduler.create(60_000, 'test')
    expect(scheduler.hasTasks()).toBe(true)
    scheduler.delete(id)
    expect(scheduler.hasTasks()).toBe(false)
  })

  it('list 返回任务列表（不含 timerId）', () => {
    scheduler.create(30_000, 'task1')
    scheduler.create(60_000, 'task2')
    const tasks = scheduler.list()
    expect(tasks).toHaveLength(2)
    for (const t of tasks) {
      expect(t).not.toHaveProperty('timerId')
      expect(t).toHaveProperty('id')
      expect(t).toHaveProperty('prompt')
      expect(t).toHaveProperty('intervalMs')
      expect(t).toHaveProperty('createdAt')
      expect(t).toHaveProperty('runCount')
    }
  })

  it('create 记录 createdAt 和初始 runCount', () => {
    const before = Date.now()
    const id = scheduler.create(10_000, 'test')
    const after = Date.now()
    const task = scheduler.list().find(t => t.id === id)!
    expect(task.runCount).toBe(0)
    expect(task.createdAt).toBeGreaterThanOrEqual(before)
    expect(task.createdAt).toBeLessThanOrEqual(after)
  })

  it('多次 deleteAll 返回正确计数', () => {
    scheduler.create(1000, 'a')
    expect(scheduler.deleteAll()).toBe(1)
    expect(scheduler.deleteAll()).toBe(0)
  })

  it('delete 后 hasTasks 为 false', () => {
    const id1 = scheduler.create(1000, 'a')
    const id2 = scheduler.create(2000, 'b')
    scheduler.delete(id1)
    expect(scheduler.hasTasks()).toBe(true)
    scheduler.delete(id2)
    expect(scheduler.hasTasks()).toBe(false)
  })
})
