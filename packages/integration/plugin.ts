/**
 * 插件系统 - 插件注册、加载、生命周期管理
 */

export type PluginState = 'inactive' | 'active' | 'error' | 'loading' | 'unloading'

export interface Plugin {
  name: string
  version: string
  description?: string
  dependencies?: string[]
  state?: PluginState
  init?(): Promise<void>
  boot(): Promise<void>
  shutdown(): Promise<void>
  destroy?(): Promise<void>
  onError?(error: Error): Promise<void>
}

export type PluginHooks = {
  'plugin:init': (plugin: Plugin) => Promise<void> | void
  'plugin:boot': (plugin: Plugin) => Promise<void> | void
  'plugin:shutdown': (plugin: Plugin) => Promise<void> | void
  'plugin:destroy': (plugin: Plugin) => Promise<void> | void
  'plugin:error': (plugin: Plugin, error: Error) => Promise<void> | void
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
  private loadOrder: string[] = []

  /**
   * 注册插件
   */
  async register(plugin: Plugin): Promise<void> {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin ${plugin.name} already registered`)
    }

    plugin.state = 'loading'
    this.plugins.set(plugin.name, plugin)

    // 解析依赖
    if (plugin.dependencies?.length) {
      for (const dep of plugin.dependencies) {
        if (!this.plugins.has(dep)) {
          throw new Error(`Plugin ${plugin.name} depends on ${dep}, which is not registered`)
        }
      }
    }

    try {
      if (plugin.init) {
        await plugin.init()
        await this.emit('plugin:init', plugin)
      }
      await plugin.boot()
      plugin.state = 'active'
      await this.emit('plugin:boot', plugin)
      this.loadOrder.push(plugin.name)
    } catch (error) {
      plugin.state = 'error'
      await this.emit('plugin:error', plugin, error as Error)
      if (plugin.onError) {
        await plugin.onError(error as Error)
      }
      throw error
    }
  }

  /**
   * 卸载插件
   */
  async unregister(name: string): Promise<void> {
    const plugin = this.plugins.get(name)
    if (plugin) {
      plugin.state = 'unloading'
      await this.emit('plugin:shutdown', plugin)
      await plugin.shutdown()
      if (plugin.destroy) {
        await plugin.destroy()
        await this.emit('plugin:destroy', plugin)
      }
      plugin.state = 'inactive'
      this.plugins.delete(name)
      this.loadOrder = this.loadOrder.filter(n => n !== name)
    }
  }

  /**
   * 按依赖顺序获取插件
   */
  private getSortedPlugins(): Plugin[] {
    const sorted: Plugin[] = []
    const visited = new Set<string>()
    const visiting = new Set<string>()

    const visit = (name: string) => {
      if (visited.has(name)) return
      if (visiting.has(name)) throw new Error(`Circular dependency detected: ${name}`)
      visiting.add(name)

      const plugin = this.plugins.get(name)
      if (plugin?.dependencies) {
        for (const dep of plugin.dependencies) {
          visit(dep)
        }
      }

      visiting.delete(name)
      visited.add(name)
      if (plugin) sorted.push(plugin)
    }

    for (const name of this.plugins.keys()) {
      visit(name)
    }
    return sorted
  }

  /**
   * 关闭所有插件（按依赖逆序）
   */
  async shutdownAll(): Promise<void> {
    const sorted = this.getSortedPlugins().reverse()
    for (const plugin of sorted) {
      await this.unregister(plugin.name)
    }
  }

  /**
   * 获取插件状态
   */
  getPluginState(name: string): PluginState | undefined {
    return this.plugins.get(name)?.state
  }

  /**
   * 检查插件是否活跃
   */
  isPluginActive(name: string): boolean {
    return this.plugins.get(name)?.state === 'active'
  }

  /**
   * 获取插件依赖
   */
  getPluginDependencies(name: string): string[] {
    return this.plugins.get(name)?.dependencies || []
  }

  /**
   * 按状态获取插件
   */
  getPluginsByState(state: PluginState): Plugin[] {
    return Array.from(this.plugins.values()).filter(p => p.state === state)
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
