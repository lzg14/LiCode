/**
 * 插件系统 - 插件注册、加载、生命周期管理
 */

export interface Plugin {
  name: string
  version: string
  description?: string
  boot(): Promise<void>
  shutdown(): Promise<void>
}

export type PluginHooks = {
  'before:tool:execute': (toolName: string, input: unknown) => Promise<void> | void
  'after:tool:execute': (toolName: string, input: unknown, output: unknown) => Promise<void> | void
  'before:llm:call': (request: unknown) => Promise<void> | void
  'after:llm:call': (request: unknown, response: unknown) => Promise<void> | void
  'session:start': (sessionId: string) => Promise<void> | void
  'session:end': (sessionId: string) => Promise<void> | void
}

export class PluginManager {
  private plugins = new Map<string, Plugin>()
  private hooks = new Map<string, Set<Function>>()

  /**
   * 注册插件
   */
  async register(plugin: Plugin): Promise<void> {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin ${plugin.name} already registered`)
    }

    this.plugins.set(plugin.name, plugin)
    await plugin.boot()
  }

  /**
   * 卸载插件
   */
  async unregister(name: string): Promise<void> {
    const plugin = this.plugins.get(name)
    if (plugin) {
      await plugin.shutdown()
      this.plugins.delete(name)
    }
  }

  /**
   * 添加 Hook
   */
  on<K extends keyof PluginHooks>(event: K, handler: PluginHooks[K]): void {
    if (!this.hooks.has(event)) {
      this.hooks.set(event, new Set())
    }
    this.hooks.get(event)!.add(handler)
  }

  /**
   * 移除 Hook
   */
  off<K extends keyof PluginHooks>(event: K, handler: PluginHooks[K]): void {
    this.hooks.get(event)?.delete(handler)
  }

  /**
   * 触发 Hook
   */
  async emit<K extends keyof PluginHooks>(
    event: K,
    ...args: Parameters<PluginHooks[K]>
  ): Promise<void> {
    const handlers = this.hooks.get(event)
    if (handlers) {
      for (const handler of handlers) {
        await (handler as Function)(...args)
      }
    }
  }

  /**
   * 列出所有插件
   */
  list(): Plugin[] {
    return Array.from(this.plugins.values())
  }

  /**
   * 获取插件
   */
  get(name: string): Plugin | undefined {
    return this.plugins.get(name)
  }
}

export const pluginManager = new PluginManager()
