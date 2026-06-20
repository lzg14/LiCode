import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PluginManager } from '../plugin'

function testPlugin(name: string, deps?: string[]) {
  return {
    name, version: '1.0.0', dependencies: deps,
    init: vi.fn().mockResolvedValue(undefined),
    boot: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
  }
}

describe('PluginManager', () => {
  let pm: PluginManager

  beforeEach(() => { vi.clearAllMocks(); pm = new PluginManager() })

  it('register 添加插件并调用 init 和 boot', async () => {
    const p = testPlugin('p')
    await pm.register(p)
    expect(p.init).toHaveBeenCalledOnce()
    expect(p.boot).toHaveBeenCalledOnce()
  })

  it('register 重复插件抛出', async () => {
    await pm.register(testPlugin('d'))
    await expect(pm.register(testPlugin('d'))).rejects.toThrow('already registered')
  })

  it('register 依赖缺失抛出', async () => {
    await expect(pm.register(testPlugin('p', ['missing']))).rejects.toThrow('depends on missing')
  })

  it('register 依赖满足时成功', async () => {
    await pm.register(testPlugin('base'))
    await expect(pm.register(testPlugin('ext', ['base']))).resolves.not.toThrow()
  })

  it('register 成功后 state=active', async () => {
    await pm.register(testPlugin('p'))
    expect(pm.getPluginState('p')).toBe('active')
    expect(pm.isPluginActive('p')).toBe(true)
  })

  it('register 失败时 state=error 并抛出', async () => {
    const p = testPlugin('p')
    p.init = vi.fn().mockRejectedValue(new Error('fail'))
    await expect(pm.register(p)).rejects.toThrow('fail')
    expect(pm.getPluginState('p')).toBe('error')
  })

  it('register 失败调用 onError', async () => {
    const onError = vi.fn()
    const p = { ...testPlugin('p'), onError }
    p.init = vi.fn().mockRejectedValue(new Error('f'))
    await expect(pm.register(p)).rejects.toThrow()
    expect(onError).toHaveBeenCalledWith(expect.any(Error))
  })

  it('unregister 调用 shutdown/destroy 并移除', async () => {
    const p = testPlugin('p')
    await pm.register(p)
    await pm.unregister('p')
    expect(p.shutdown).toHaveBeenCalledOnce()
    expect(p.destroy).toHaveBeenCalledOnce()
    expect(pm.get('p')).toBeUndefined()
  })

  it('unregister 不存在的插件不报错', async () => {
    await expect(pm.unregister('none')).resolves.not.toThrow()
  })

  it('shutdownAll 关闭所有插件', async () => {
    await pm.register(testPlugin('a'))
    await pm.register(testPlugin('b'))
    await pm.shutdownAll()
    expect(pm.list()).toHaveLength(0)
  })

  it('on/emit 钩子系统正常工作', async () => {
    const h = vi.fn()
    pm.on('plugin:boot', h)
    await pm.register(testPlugin('p'))
    expect(h).toHaveBeenCalled()
  })

  it('off 移除钩子', async () => {
    const h = vi.fn()
    pm.on('plugin:init', h)
    pm.off('plugin:init', h)
    await pm.register(testPlugin('p'))
    expect(h).not.toHaveBeenCalled()
  })

  it('getPluginsByState 按状态筛选', async () => {
    await pm.register(testPlugin('ok'))
    const p2 = testPlugin('bad')
    p2.init = vi.fn().mockRejectedValue(new Error('f'))
    await expect(pm.register(p2)).rejects.toThrow()
    expect(pm.getPluginsByState('active')).toHaveLength(1)
    expect(pm.getPluginsByState('error')).toHaveLength(1)
  })

  it('list/get/getPluginDependencies 查询方法正常', async () => {
    const p = testPlugin('p')
    await pm.register(p)
    expect(pm.list()).toHaveLength(1)
    expect(pm.get('p')).toBe(p)
    expect(pm.get('missing')).toBeUndefined()
    expect(pm.getPluginDependencies('missing')).toEqual([])
  })

  it('isPluginActive 检查活跃状态', async () => {
    expect(pm.isPluginActive('missing')).toBe(false)
    await pm.register(testPlugin('p'))
    expect(pm.isPluginActive('p')).toBe(true)
  })
})
