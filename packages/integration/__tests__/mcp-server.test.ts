import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../mcp', () => ({ MCPIntegration: vi.fn() }))

import { MCPServerManager } from '../mcp-server'
import { MCPIntegration } from '../mcp'

describe('MCPServerManager', () => {
  let mgr: MCPServerManager

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(MCPIntegration).mockImplementation(() => ({
      name: 'mcp', enabled: false,
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      health: vi.fn().mockResolvedValue({ healthy: true }),
    }))
    mgr = new MCPServerManager()
  })

  it('addServer 添加并连接', async () => {
    await mgr.addServer({ id: 's1', command: 'node' })
    const s = mgr.getServerStatus('s1')
    expect(s?.connected).toBe(true)
    expect(s?.healthy).toBe(true)
  })

  it('addServer 重复 id 抛出', async () => {
    await mgr.addServer({ id: 'd', command: 'n' })
    await expect(mgr.addServer({ id: 'd', command: 'n' })).rejects.toThrow('already exists')
  })

  it('addServer 连接失败设置错误状态', async () => {
    vi.mocked(MCPIntegration).mockImplementation(() => ({
      connect: vi.fn().mockRejectedValue(new Error('Connection refused')),
      disconnect: vi.fn(), health: vi.fn(), name: 'mcp', enabled: false,
    }))
    await mgr.addServer({ id: 'f', command: 'n' })
    const s = mgr.getServerStatus('f')
    expect(s?.connected).toBe(false)
    expect(s?.healthy).toBe(false)
    expect(s?.error).toBe('Connection refused')
  })

  it('getServer 和 getServerStatus 查询', async () => {
    await mgr.addServer({ id: 's', command: 'n' })
    expect(mgr.getServer('s')).toBeDefined()
    expect(mgr.getServer('x')).toBeUndefined()
    expect(mgr.getServerStatus('s')?.id).toBe('s')
  })

  it('removeServer 断开并移除', async () => {
    await mgr.addServer({ id: 's', command: 'n' })
    await mgr.removeServer('s')
    expect(mgr.getServer('s')).toBeUndefined()
  })

  it('removeServer 不存在跳过', async () => {
    await expect(mgr.removeServer('none')).resolves.not.toThrow()
  })

  it('getAllServerStatus 返回所有状态', async () => {
    await mgr.addServer({ id: 'a', command: 'n' })
    await mgr.addServer({ id: 'b', command: 'n' })
    expect(mgr.getAllServerStatus()).toHaveLength(2)
  })

  it('getConnectedServers 过滤已连接', async () => {
    await mgr.addServer({ id: 'con', command: 'n' })
    vi.mocked(MCPIntegration).mockImplementation(() => ({
      connect: vi.fn().mockRejectedValue(new Error('fail')),
      disconnect: vi.fn(), health: vi.fn(), name: 'mcp', enabled: false,
    }))
    await mgr.addServer({ id: 'dis', command: 'n' })
    expect(mgr.getConnectedServers()).toHaveLength(1)
  })

  it('disconnectServer 断开并更新状态', async () => {
    const dc = vi.fn().mockResolvedValue(undefined)
    vi.mocked(MCPIntegration).mockImplementation(() => ({
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: dc, health: vi.fn(), name: 'mcp', enabled: false,
    }))
    await mgr.addServer({ id: 's', command: 'n' })
    await mgr.disconnectServer('s')
    expect(dc).toHaveBeenCalled()
    expect(mgr.getServerStatus('s')?.connected).toBe(false)
  })

  it('disconnectServer 不存在抛出', async () => {
    await expect(mgr.disconnectServer('none')).rejects.toThrow('not found')
  })

  it('connectServer 重新连接', async () => {
    const c = vi.fn().mockResolvedValue(undefined)
    vi.mocked(MCPIntegration).mockImplementation(() => ({
      connect: c, disconnect: vi.fn(), health: vi.fn(), name: 'mcp', enabled: false,
    }))
    await mgr.addServer({ id: 's', command: 'n' })
    c.mockClear()
    await mgr.connectServer('s')
    expect(c).toHaveBeenCalled()
  })

  it('checkHealth 更新健康状态', async () => {
    const h = vi.fn().mockResolvedValue({ healthy: true, latency: 3 })
    vi.mocked(MCPIntegration).mockImplementation(() => ({
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(), health: h, name: 'mcp', enabled: false,
    }))
    await mgr.addServer({ id: 's', command: 'n' })
    const s = await mgr.checkHealth('s')
    expect(s.healthy).toBe(true)
    expect(s.latency).toBe(3)
  })

  it('checkAllHealth 检查所有', async () => {
    await mgr.addServer({ id: 'a', command: 'n' })
    await mgr.addServer({ id: 'b', command: 'n' })
    const results = await mgr.checkAllHealth()
    expect(results).toHaveLength(2)
  })

  it('shutdown 清理所有', async () => {
    const dc = vi.fn().mockResolvedValue(undefined)
    vi.mocked(MCPIntegration).mockImplementation(() => ({
      connect: vi.fn(), disconnect: dc, health: vi.fn(), name: 'mcp', enabled: false,
    }))
    await mgr.addServer({ id: 'a', command: 'n' })
    await mgr.addServer({ id: 'b', command: 'n' })
    await mgr.shutdown()
    expect(dc).toHaveBeenCalledTimes(2)
    expect(mgr.getAllServerStatus()).toHaveLength(0)
  })

  it('startGlobalHealthCheck / stopGlobalHealthCheck', () => {
    mgr.startGlobalHealthCheck(5000)
    mgr.stopGlobalHealthCheck()
    expect(true).toBe(true)
  })
})
