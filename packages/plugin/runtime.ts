/**
 * 插件运行时 - 提供插件执行环境和沙箱
 */

import { Plugin, PluginManager } from '../integration/plugin'

export interface PluginContext {
  plugin: Plugin
  config: Record<string, unknown>
  logger: PluginLogger
  services: PluginServices
}

export interface PluginLogger {
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
  debug(message: string, ...args: unknown[]): void
}

export interface PluginServices {
  get<T>(name: string): T | undefined
  set<T>(name: string, service: T): void
  has(name: string): boolean
}

export class PluginSandbox {
  private contexts = new Map<string, PluginContext>()
  private services = new Map<string, unknown>()

  constructor(private pluginManager: PluginManager) {}

  /**
   * 创建插件上下文
   */
  createContext(plugin: Plugin, config: Record<string, unknown> = {}): PluginContext {
    const context: PluginContext = {
      plugin,
      config,
      logger: this.createLogger(plugin.name),
      services: this.createServices(plugin.name),
    }
    this.contexts.set(plugin.name, context)
    return context
  }

  /**
   * 获取插件上下文
   */
  getContext(pluginName: string): PluginContext | undefined {
    return this.contexts.get(pluginName)
  }

  /**
   * 移除插件上下文
   */
  removeContext(pluginName: string): void {
    this.contexts.delete(pluginName)
  }

  /**
   * 在沙箱中执行插件代码
   */
  async execute<T>(pluginName: string, fn: () => Promise<T>): Promise<T> {
    const context = this.contexts.get(pluginName)
    if (!context) {
      throw new Error(`No context found for plugin: ${pluginName}`)
    }

    // 创建隔离的执行环境
    const sandbox = {
      console: this.createSandboxConsole(pluginName),
      setTimeout: globalThis.setTimeout,
      setInterval: globalThis.setInterval,
      clearTimeout: globalThis.clearTimeout,
      clearInterval: globalThis.clearInterval,
    }

    // 使用 vm 模块创建沙箱（如果可用）
    // 这里简化实现，实际应使用 Node.js vm 模块
    return fn()
  }

  /**
   * 创建插件日志器
   */
  private createLogger(pluginName: string): PluginLogger {
    const prefix = `[Plugin:${pluginName}]`
    return {
      info: (message, ...args) => console.info(prefix, message, ...args),
      warn: (message, ...args) => console.warn(prefix, message, ...args),
      error: (message, ...args) => console.error(prefix, message, ...args),
      debug: (message, ...args) => console.debug(prefix, message, ...args),
    }
  }

  /**
   * 创建插件服务容器
   */
  private createServices(pluginName: string): PluginServices {
    const namespace = `plugin:${pluginName}:`
    return {
      get: <T>(name: string) => this.services.get(namespace + name) as T | undefined,
      set: <T>(name: string, service: T) => this.services.set(namespace + name, service),
      has: (name: string) => this.services.has(namespace + name),
    }
  }

  /**
   * 创建沙箱控制台
   */
  private createSandboxConsole(pluginName: string) {
    const prefix = `[Plugin:${pluginName}]`
    return {
      log: (...args: unknown[]) => console.log(prefix, ...args),
      info: (...args: unknown[]) => console.info(prefix, ...args),
      warn: (...args: unknown[]) => console.warn(prefix, ...args),
      error: (...args: unknown[]) => console.error(prefix, ...args),
      debug: (...args: unknown[]) => console.debug(prefix, ...args),
    }
  }
}

export class PluginRuntime {
  private sandbox: PluginSandbox

  constructor(private pluginManager: PluginManager) {
    this.sandbox = new PluginSandbox(pluginManager)
  }

  /**
   * 启动插件运行时
   */
  async start(): Promise<void> {
    // 为所有已注册的插件创建上下文
    for (const plugin of this.pluginManager.list()) {
      this.sandbox.createContext(plugin)
    }
  }

  /**
   * 停止插件运行时
   */
  async stop(): Promise<void> {
    // 清理所有上下文
    for (const plugin of this.pluginManager.list()) {
      this.sandbox.removeContext(plugin.name)
    }
  }

  /**
   * 获取沙箱
   */
  getSandbox(): PluginSandbox {
    return this.sandbox
  }

  /**
   * 在插件上下文中执行函数
   */
  async executeInContext<T>(pluginName: string, fn: (ctx: PluginContext) => Promise<T>): Promise<T> {
    const context = this.sandbox.getContext(pluginName)
    if (!context) {
      throw new Error(`No context found for plugin: ${pluginName}`)
    }
    return this.sandbox.execute(pluginName, () => fn(context))
  }
}

export function createPluginRuntime(pluginManager: PluginManager): PluginRuntime {
  return new PluginRuntime(pluginManager)
}