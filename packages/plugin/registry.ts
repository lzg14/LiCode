/**
 * 插件注册表 - 插件注册、查询和元数据管理
 */

import { Plugin, PluginManager, PluginState } from '../integration/plugin'

export interface PluginMetadata {
  name: string
  version: string
  description?: string
  author?: string
  license?: string
  homepage?: string
  repository?: string
  keywords?: string[]
  dependencies?: string[]
  config?: Record<string, unknown>
  loadedAt?: Date
  state?: PluginState
}

export interface PluginQueryOptions {
  state?: PluginState
  keyword?: string
  dependency?: string
  sortBy?: 'name' | 'version' | 'loadedAt'
  sortOrder?: 'asc' | 'desc'
}

export class PluginRegistry {
  private metadata = new Map<string, PluginMetadata>()

  constructor(private pluginManager: PluginManager) {}

  /**
   * 注册插件元数据
   */
  registerMetadata(metadata: PluginMetadata): void {
    this.metadata.set(metadata.name, {
      ...metadata,
      loadedAt: new Date(),
      state: 'inactive',
    })
  }

  /**
   * 更新插件状态
   */
  updateState(name: string, state: PluginState): void {
    const meta = this.metadata.get(name)
    if (meta) {
      meta.state = state
    }
  }

  /**
   * 获取插件元数据
   */
  getMetadata(name: string): PluginMetadata | undefined {
    return this.metadata.get(name)
  }

  /**
   * 移除插件元数据
   */
  removeMetadata(name: string): void {
    this.metadata.delete(name)
  }

  /**
   * 查询插件
   */
  query(options: PluginQueryOptions = {}): PluginMetadata[] {
    let results = Array.from(this.metadata.values())

    // 按状态过滤
    if (options.state) {
      results = results.filter(m => m.state === options.state)
    }

    // 按关键词过滤
    if (options.keyword) {
      const keyword = options.keyword.toLowerCase()
      results = results.filter(m =>
        m.name.toLowerCase().includes(keyword) ||
        m.description?.toLowerCase().includes(keyword) ||
        m.keywords?.some(k => k.toLowerCase().includes(keyword))
      )
    }

    // 按依赖过滤
    if (options.dependency) {
      results = results.filter(m =>
        m.dependencies?.includes(options.dependency)
      )
    }

    // 排序
    if (options.sortBy) {
      results.sort((a, b) => {
        const aVal = a[options.sortBy!] || ''
        const bVal = b[options.sortBy!] || ''
        const comparison = String(aVal).localeCompare(String(bVal))
        return options.sortOrder === 'desc' ? -comparison : comparison
      })
    }

    return results
  }

  /**
   * 获取所有活跃插件
   */
  getActivePlugins(): PluginMetadata[] {
    return this.query({ state: 'active' })
  }

  /**
   * 获取插件依赖树
   */
  getDependencyTree(name: string, depth = 0, visited = new Set<string>()): Record<string, unknown> {
    if (visited.has(name)) {
      return { name, circular: true }
    }
    visited.add(name)

    const meta = this.metadata.get(name)
    if (!meta) {
      return { name, found: false }
    }

    const tree: Record<string, unknown> = {
      name,
      version: meta.version,
      state: meta.state,
    }

    if (meta.dependencies?.length) {
      tree.dependencies = meta.dependencies.map(dep =>
        this.getDependencyTree(dep, depth + 1, new Set(visited))
      )
    }

    return tree
  }

  /**
   * 检查插件依赖是否满足
   */
  checkDependencies(name: string): { satisfied: boolean; missing: string[] } {
    const meta = this.metadata.get(name)
    if (!meta?.dependencies) {
      return { satisfied: true, missing: [] }
    }

    const missing = meta.dependencies.filter(dep => {
      const depMeta = this.metadata.get(dep)
      return !depMeta || depMeta.state !== 'active'
    })

    return {
      satisfied: missing.length === 0,
      missing,
    }
  }

  /**
   * 导出注册表数据
   */
  export(): Record<string, PluginMetadata> {
    const data: Record<string, PluginMetadata> = {}
    for (const [name, meta] of this.metadata) {
      data[name] = { ...meta }
    }
    return data
  }

  /**
   * 导入注册表数据
   */
  import(data: Record<string, PluginMetadata>): void {
    for (const [name, meta] of Object.entries(data)) {
      this.metadata.set(name, meta)
    }
  }

  /**
   * 清空注册表
   */
  clear(): void {
    this.metadata.clear()
  }
}

export function createPluginRegistry(pluginManager: PluginManager): PluginRegistry {
  return new PluginRegistry(pluginManager)
}