/**
 * ExtensionManager - 扩展管理器
 * 
 * 负责：
 * - 发现和加载扩展
 * - 管理扩展生命周期
 * - 分发事件到扩展
 * - 提供 ExtensionAPI 实现
 */

import { readdir, readFile, stat, access } from 'fs/promises'
import { join, resolve } from 'path'
import { homedir } from 'os'
import { devLogger } from '../core/dev-logger'
import { pluginManager, type Plugin } from '../integration/plugin'
import type {
  CommandHandler,
  EventHandler,
  ExtensionAPI,
  ExtensionEventType,
  ExtensionFactory,
  ExtensionInfo,
  ToolDefinition,
  UIComponent,
} from './types'

/** 已注册的扩展 */
interface RegisteredExtension {
  info: ExtensionInfo
  factory: ExtensionFactory
  api?: ExtensionAPI
}

/** 已注册的工具 */
interface RegisteredTool {
  name: string
  tool: ToolDefinition
  extensionName: string
}

/** 已注册的命令 */
interface RegisteredCommand {
  name: string
  handler: CommandHandler
  extensionName: string
}

/** 已注册的事件处理器 */
interface RegisteredEventHandler {
  event: ExtensionEventType
  handler: EventHandler
  extensionName: string
}

export class ExtensionManager {
  private extensions: Map<string, RegisteredExtension> = new Map()
  private tools: Map<string, RegisteredTool> = new Map()
  private commands: Map<string, RegisteredCommand> = new Map()
  private eventHandlers: Map<ExtensionEventType, RegisteredEventHandler[]> = new Map()
  private uiComponents: Map<string, UIComponent> = new Map()
  
  constructor(
    private globalDir: string = join(homedir(), '.licode', 'extensions'),
    private projectDir?: string,
  ) {}

  /**
   * 扫描并加载所有扩展
   */
  async loadAll(): Promise<{ loaded: number; errors: number }> {
    let loaded = 0
    let errors = 0

    // 加载全局扩展
    try {
      const globalCount = await this.loadFromDir(this.globalDir)
      loaded += globalCount
    } catch (e) {
      devLogger.warn('EXT', `Failed to load global extensions: ${e}`)
    }

    // 加载项目级扩展
    if (this.projectDir) {
      try {
        const projectCount = await this.loadFromDir(this.projectDir)
        loaded += projectCount
      } catch (e) {
        devLogger.warn('EXT', `Failed to load project extensions: ${e}`)
      }
    }

    devLogger.info('EXT', `Loaded ${loaded} extensions`)
    return { loaded, errors }
  }

  /**
   * 从目录加载扩展
   */
  private async loadFromDir(dir: string): Promise<number> {
    try {
      await access(dir)
    } catch {
      return 0
    }

    let count = 0
    const entries = await readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const extDir = join(dir, entry.name)
      try {
        await this.loadExtension(extDir, entry.name)
        count++
      } catch (e) {
        devLogger.warn('EXT', `Failed to load extension ${entry.name}: ${e}`)
      }
    }

    return count
  }

  /**
   * 加载单个扩展
   */
  private async loadExtension(dir: string, name: string): Promise<void> {
    // 尝试读取 package.json 获取元数据
    let info: ExtensionInfo = { name }
    try {
      const pkgPath = join(dir, 'package.json')
      const pkgContent = await readFile(pkgPath, 'utf-8')
      const pkg = JSON.parse(pkgContent)
      info = {
        name: pkg.name || name,
        version: pkg.version,
        description: pkg.description,
        author: pkg.author,
      }
    } catch {
      // 没有 package.json 也继续
    }

    // 尝试加载入口文件
    const possibleEntries = ['index.js', 'index.ts', 'index.mjs', 'main.js', 'main.ts']
    let entryPath: string | null = null

    for (const entry of possibleEntries) {
      try {
        const fullPath = join(dir, entry)
        await access(fullPath)
        entryPath = fullPath
        break
      } catch {
        continue
      }
    }

    if (!entryPath) {
      throw new Error(`No entry file found in ${dir}`)
    }

    // 动态导入扩展
    const extModule = await import(entryPath)
    const factory: ExtensionFactory = extModule.default || extModule

    if (typeof factory !== 'function') {
      throw new Error(`Extension ${name} does not export a function`)
    }

    // 创建 API 实例并执行工厂函数
    const api = this.createAPI(info)
    await factory(api)

    // 注册为 pluginManager 的插件（集成现有插件系统）
    const self = this
    const plugin: Plugin = {
      name: info.name,
      version: info.version || '0.0.0',
      description: info.description,
      state: 'active',
      async boot() {},
      async shutdown() {
        // 清理该扩展注册的工具、命令、事件处理器
        self.removeExtension(info.name)
      },
    }
    
    try {
      await pluginManager.register(plugin)
    } catch (e) {
      // 插件可能已注册，忽略错误
      devLogger.debug('EXT', `Plugin ${info.name} already registered in pluginManager`)
    }

    this.extensions.set(name, { info, factory, api })
    devLogger.info('EXT', `Loaded extension: ${info.name}@${info.version || 'unknown'}`)
  }

  /**
   * 为扩展创建 API 实例
   */
  private createAPI(info: ExtensionInfo): ExtensionAPI {
    const self = this

    return {
      registerTool(tool: ToolDefinition): void {
        if (self.tools.has(tool.name)) {
          devLogger.warn('EXT', `Tool ${tool.name} already registered, overwriting`)
        }
        self.tools.set(tool.name, { name: tool.name, tool, extensionName: info.name })
        devLogger.debug('EXT', `Registered tool: ${tool.name}`)
      },

      registerCommand(name: string, handler: CommandHandler): void {
        if (self.commands.has(name)) {
          devLogger.warn('EXT', `Command ${name} already registered, overwriting`)
        }
        self.commands.set(name, { name, handler, extensionName: info.name })
        devLogger.debug('EXT', `Registered command: ${name}`)
      },

      on<T = unknown>(event: ExtensionEventType, handler: EventHandler<T>): void {
        const handlers = self.eventHandlers.get(event) || []
        handlers.push({
          event,
          handler: handler as EventHandler,
          extensionName: info.name,
        })
        self.eventHandlers.set(event, handlers)
        devLogger.debug('EXT', `Registered event handler for: ${event}`)
      },

      registerUI(component: UIComponent): void {
        self.uiComponents.set(component.name, component)
        devLogger.debug('EXT', `Registered UI component: ${component.name}`)
      },

      getExtensionInfo(): ExtensionInfo {
        return { ...info }
      },

      log: {
        info: (message: string, ...args: unknown[]) => devLogger.info(info.name.toUpperCase(), message, ...args),
        warn: (message: string, ...args: unknown[]) => devLogger.warn(info.name.toUpperCase(), message, ...args),
        error: (message: string, ...args: unknown[]) => devLogger.error(info.name.toUpperCase(), message, ...args),
        debug: (message: string, ...args: unknown[]) => devLogger.debug(info.name.toUpperCase(), message, ...args),
      },
    }
  }

  // ============================================================
  // 查询方法
  // ============================================================

  /**
   * 获取所有已注册的工具
   */
  getTools(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(t => t.tool)
  }

  /**
   * 获取指定名称的工具
   */
  getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name)?.tool
  }

  /**
   * 获取所有已注册的命令
   */
  getCommands(): Map<string, CommandHandler> {
    const result = new Map<string, CommandHandler>()
    for (const [name, cmd] of this.commands) {
      result.set(name, cmd.handler)
    }
    return result
  }

  /**
   * 获取指定名称的命令
   */
  getCommand(name: string): CommandHandler | undefined {
    return this.commands.get(name)?.handler
  }

  /**
   * 获取指定事件的所有处理器
   */
  getEventHandlers(event: ExtensionEventType): EventHandler[] {
    return (this.eventHandlers.get(event) || []).map(h => h.handler)
  }

  /**
   * 获取所有 UI 组件
   */
  getUIComponents(): UIComponent[] {
    return Array.from(this.uiComponents.values())
  }

  /**
   * 获取所有已加载的扩展信息
   */
  getLoadedExtensions(): ExtensionInfo[] {
    return Array.from(this.extensions.values()).map(e => e.info)
  }

  // ============================================================
  // 扩展清理
  // ============================================================

  /**
   * 移除指定扩展注册的所有内容
   */
  private removeExtension(extensionName: string): void {
    // 移除工具
    for (const [name, tool] of this.tools) {
      if (tool.extensionName === extensionName) {
        this.tools.delete(name)
      }
    }

    // 移除命令
    for (const [name, cmd] of this.commands) {
      if (cmd.extensionName === extensionName) {
        this.commands.delete(name)
      }
    }

    // 移除事件处理器
    for (const [event, handlers] of this.eventHandlers) {
      const filtered = handlers.filter(h => h.extensionName !== extensionName)
      if (filtered.length === 0) {
        this.eventHandlers.delete(event)
      } else {
        this.eventHandlers.set(event, filtered)
      }
    }

    // 移除 UI 组件
    for (const [name, component] of this.uiComponents) {
      // UI 组件没有 extensionName，暂时跳过
    }

    this.extensions.delete(extensionName)
    devLogger.info('EXT', `Removed extension: ${extensionName}`)
  }

  // ============================================================
  // 事件分发
  // ============================================================

  /**
   * 触发事件
   */
  async emit(event: ExtensionEventType, context: Record<string, unknown> = {}): Promise<void> {
    const handlers = this.eventHandlers.get(event) || []
    
    for (const { handler, extensionName } of handlers) {
      try {
        await handler(context, {
          cwd: (context.cwd as string) || process.cwd(),
          sessionId: context.sessionId as string | undefined,
          ...context,
        })
      } catch (e) {
        devLogger.warn('EXT', `Event handler ${event} failed in ${extensionName}: ${e}`)
      }
    }
  }

  // ============================================================
  // 生命周期
  // ============================================================

  /**
   * 卸载所有扩展
   */
  async unloadAll(): Promise<void> {
    // 触发 shutdown 事件
    await this.emit('shutdown')

    // 通过 pluginManager 关闭所有插件
    await pluginManager.shutdownAll()

    this.extensions.clear()
    this.tools.clear()
    this.commands.clear()
    this.eventHandlers.clear()
    this.uiComponents.clear()
    
    devLogger.info('EXT', 'All extensions unloaded')
  }
}

// ============================================================
// 单例
// ============================================================

let globalManager: ExtensionManager | null = null

/**
 * 获取全局 ExtensionManager 单例
 */
export function getExtensionManager(): ExtensionManager {
  if (!globalManager) {
    globalManager = new ExtensionManager()
  }
  return globalManager
}

/**
 * 设置全局 ExtensionManager（用于测试）
 */
export function setExtensionManager(manager: ExtensionManager): void {
  globalManager = manager
}
