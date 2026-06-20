import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MCPToolAdapter } from '../mcp-tools'

function mockIntegration() {
  return {
    name: 'mcp', enabled: true,
    connect: vi.fn(), disconnect: vi.fn(), health: vi.fn(),
    discoverTools: vi.fn(), callTool: vi.fn(),
    getServerInfo: vi.fn(), getCapabilities: vi.fn(),
    isInitialized: vi.fn().mockReturnValue(true),
    getTools: vi.fn().mockReturnValue([]), getTool: vi.fn(),
    discoverResources: vi.fn(), readResource: vi.fn(),
    getPrompt: vi.fn(),
    withConnection: vi.fn(),
  }
}

describe('MCPToolAdapter', () => {
  let a: MCPToolAdapter

  beforeEach(() => { vi.clearAllMocks(); a = new MCPToolAdapter({ cacheTools: true }) })

  it('registerIntegration 和 discoverTools 缓存工具', async () => {
    const integration = mockIntegration()
    integration.discoverTools = vi.fn().mockResolvedValue([
      { name: 'read', description: 'read file', inputSchema: {} },
    ])
    a.registerIntegration('srv', integration)
    const tools = await a.discoverTools('srv')
    expect(tools).toHaveLength(1)
    expect(a.getRegisteredTools()).toHaveLength(1)
  })

  it('getToolByName 返回注册工具', async () => {
    const integration = mockIntegration()
    integration.discoverTools = vi.fn().mockResolvedValue([{ name: 'echo' }])
    a.registerIntegration('srv', integration)
    await a.discoverTools('srv')
    expect(a.getToolByName('echo')).toBeDefined()
    expect(a.getToolByName('nope')).toBeUndefined()
  })

  it('searchTools 按名称和描述搜索', async () => {
    const integration = mockIntegration()
    integration.discoverTools = vi.fn().mockResolvedValue([
      { name: 'file-read', description: 'Read files' },
      { name: 'dir-list', description: 'List directories' },
    ])
    a.registerIntegration('srv', integration)
    await a.discoverAllTools()
    expect(a.searchTools('file')).toHaveLength(1)
    expect(a.searchTools('directories')).toHaveLength(1)
    expect(a.searchTools('xyz')).toHaveLength(0)
  })

  it('validateArguments 缺失必填字段报错', () => {
    const schema = { required: ['path', 'mode'], properties: { path: {}, mode: {} } }
    ;(a as any).tools.set('write', { name: 'write', inputSchema: schema })
    const r = a.validateArguments('write', { path: '/tmp' })
    expect(r.valid).toBe(false)
    expect(r.errors).toContain('Missing required field: mode')
  })

  it('validateArguments 所有必填存在时通过', () => {
    const schema = { required: ['path'], properties: { path: {} } }
    ;(a as any).tools.set('write', { name: 'write', inputSchema: schema })
    expect(a.validateArguments('write', { path: '/f' }).valid).toBe(true)
  })

  it('validateArguments 无 schema 时视为有效', () => {
    ;(a as any).tools.set('simple', { name: 'simple' })
    expect(a.validateArguments('simple', { x: 1 }).valid).toBe(true)
  })

  it('validateArguments 工具不存在报错', () => {
    const r = a.validateArguments('ghost', {})
    expect(r.valid).toBe(false)
    expect(r.errors[0]).toContain('ghost')
  })

  it('clearCache 清除工具缓存', () => {
    ;(a as any).tools.set('t', { name: 't' })
    expect(a.getRegisteredTools()).toHaveLength(1)
    a.clearCache()
    expect(a.getRegisteredTools()).toHaveLength(0)
  })

  it('callToolByName 代理调用集成', async () => {
    const integration = mockIntegration()
    integration.callTool = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'result' }] })
    a.registerIntegration('srv', integration)
    ;(a as any).tools.set('echo', { name: 'echo', serverId: 'srv', integration })
    const r = await a.callToolByName('echo', { msg: 'hi' })
    expect(r.content[0].text).toBe('result')
    expect(integration.callTool).toHaveBeenCalledWith('echo', { msg: 'hi' })
  })

  it('callTool 工具不存在抛出', async () => {
    await expect(a.callTool({ name: 'none' })).rejects.toThrow('not found')
  })

  it('getToolsByServer 按 serverId 筛选', () => {
    ;(a as any).tools.set('t1', { name: 't1', serverId: 's1' })
    ;(a as any).tools.set('t2', { name: 't2', serverId: 's2' })
    expect(a.getToolsByServer('s1')).toHaveLength(1)
    expect(a.getToolsByServer('s3')).toHaveLength(0)
  })

  it('unregisterIntegration 移除集成及其工具', () => {
    const integration = mockIntegration()
    a.registerIntegration('srv', integration)
    ;(a as any).tools.set('t1', { name: 't1', serverId: 'srv', integration })
    ;(a as any).tools.set('t2', { name: 't2', serverId: 'srv', integration })
    expect(a.getRegisteredTools()).toHaveLength(2)
    a.unregisterIntegration('srv')
    expect(a.getRegisteredTools()).toHaveLength(0)
  })

  it('getToolSchema 返回工具的 inputSchema', () => {
    const schema = { type: 'object' }
    ;(a as any).tools.set('t', { name: 't', inputSchema: schema })
    expect(a.getToolSchema('t')).toBe(schema)
    expect(a.getToolSchema('none')).toBeUndefined()
  })
})
