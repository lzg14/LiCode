import { describe, expect, it, beforeEach, vi } from 'vitest'
import { ExtensionManager } from '../manager'
import type { ExtensionAPI, ToolDefinition, CommandHandler } from '../types'

describe('ExtensionManager', () => {
  let manager: ExtensionManager

  beforeEach(() => {
    manager = new ExtensionManager('/tmp/test-extensions')
  })

  describe('registerTool', () => {
    it('should register a tool via API', async () => {
      // 创建一个模拟的扩展工厂
      const factory = (api: ExtensionAPI) => {
        api.registerTool({
          name: 'test-tool',
          description: 'A test tool',
          inputSchema: { type: 'object', properties: {} },
          execute: async () => ({ success: true, output: 'test' }),
        })
      }

      // 直接测试 API 创建
      const api = (manager as any).createAPI({ name: 'test-ext' })
      factory(api)

      const tools = manager.getTools()
      expect(tools).toHaveLength(1)
      expect(tools[0].name).toBe('test-tool')
    })

    it('should get tool by name', async () => {
      const api = (manager as any).createAPI({ name: 'test-ext' })
      api.registerTool({
        name: 'my-tool',
        description: 'My tool',
        inputSchema: {},
        execute: async () => ({ success: true }),
      })

      const tool = manager.getTool('my-tool')
      expect(tool).toBeDefined()
      expect(tool?.name).toBe('my-tool')
    })

    it('should return undefined for non-existent tool', () => {
      const tool = manager.getTool('non-existent')
      expect(tool).toBeUndefined()
    })
  })

  describe('registerCommand', () => {
    it('should register a command via API', async () => {
      const api = (manager as any).createAPI({ name: 'test-ext' })
      api.registerCommand('test-cmd', {
        description: 'A test command',
        execute: async () => ({ success: true }),
      })

      const commands = manager.getCommands()
      expect(commands.size).toBe(1)
      expect(commands.has('test-cmd')).toBe(true)
    })

    it('should get command by name', async () => {
      const api = (manager as any).createAPI({ name: 'test-ext' })
      api.registerCommand('my-cmd', {
        description: 'My command',
        execute: async () => ({ success: true }),
      })

      const cmd = manager.getCommand('my-cmd')
      expect(cmd).toBeDefined()
      expect(cmd?.description).toBe('My command')
    })
  })

  describe('event handlers', () => {
    it('should register event handler via API', async () => {
      const api = (manager as any).createAPI({ name: 'test-ext' })
      const handler = vi.fn()
      api.on('session:start', handler)

      const handlers = manager.getEventHandlers('session:start')
      expect(handlers).toHaveLength(1)
      expect(handlers[0]).toBe(handler)
    })

    it('should emit events to handlers', async () => {
      const api = (manager as any).createAPI({ name: 'test-ext' })
      const handler = vi.fn()
      api.on('session:start', handler)

      await manager.emit('session:start', { sessionId: 'test-123' })

      expect(handler).toHaveBeenCalledWith(
        { sessionId: 'test-123' },
        expect.objectContaining({ sessionId: 'test-123' })
      )
    })
  })

  describe('removeExtension', () => {
    it('should remove all registered items for extension', async () => {
      const api = (manager as any).createAPI({ name: 'ext-to-remove' })
      api.registerTool({
        name: 'ext-tool',
        description: 'Tool to remove',
        inputSchema: {},
        execute: async () => ({ success: true }),
      })
      api.registerCommand('ext-cmd', {
        description: 'Command to remove',
        execute: async () => ({ success: true }),
      })

      expect(manager.getTools()).toHaveLength(1)
      expect(manager.getCommands().size).toBe(1)

      // 调用私有方法移除扩展
      ;(manager as any).removeExtension('ext-to-remove')

      expect(manager.getTools()).toHaveLength(0)
      expect(manager.getCommands().size).toBe(0)
    })
  })

  describe('loaded extensions', () => {
    it('should track loaded extensions', async () => {
      const api = (manager as any).createAPI({ 
        name: 'my-ext', 
        version: '1.0.0',
        description: 'My extension' 
      })
      // 模拟扩展加载
      ;(manager as any).extensions.set('my-ext', {
        info: { name: 'my-ext', version: '1.0.0', description: 'My extension' },
        factory: () => {},
        api,
      })

      const extensions = manager.getLoadedExtensions()
      expect(extensions).toHaveLength(1)
      expect(extensions[0].name).toBe('my-ext')
    })
  })
})
