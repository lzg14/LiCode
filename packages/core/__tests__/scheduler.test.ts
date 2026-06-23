import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Scheduler } from '../scheduler'

describe('Scheduler', () => {
  let scheduler: Scheduler
  let onTrigger: ReturnType<typeof vi.fn>
  let onLog: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    onTrigger = vi.fn().mockResolvedValue(undefined)
    onLog = vi.fn()
    scheduler = new Scheduler({ onTrigger, onLog })
  })

  afterEach(() => {
    scheduler.deleteAll()
    vi.useRealTimers()
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

  it('create 创建任务并定时触发', async () => {
    const id = scheduler.create(60_000, 'test prompt')
    expect(id).toBeTruthy()
    expect(scheduler.list()).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(59_000)
    expect(onTrigger).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1_000)
    expect(onTrigger).toHaveBeenCalledWith('test prompt')
  })

  it('delete 取消任务', async () => {
    const id = scheduler.create(60_000, 'test')
    expect(scheduler.delete(id)).toBe(true)
    expect(scheduler.list()).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(onTrigger).not.toHaveBeenCalled()
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

  it('触发后自动重新调度', async () => {
    scheduler.create(30_000, 'repeat')

    await vi.advanceTimersByTimeAsync(30_000)
    expect(onTrigger).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(30_000)
    expect(onTrigger).toHaveBeenCalledTimes(2)
  })

  it('执行出错不影响后续调度', async () => {
    onTrigger.mockRejectedValueOnce(new Error('fail'))
    scheduler.create(10_000, 'test')

    await vi.advanceTimersByTimeAsync(10_000)
    expect(onTrigger).toHaveBeenCalledTimes(1)
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('执行出错'))

    await vi.advanceTimersByTimeAsync(10_000)
    expect(onTrigger).toHaveBeenCalledTimes(2)
  })
})
