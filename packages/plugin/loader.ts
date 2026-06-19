/**
 * 插件加载器 - 插件发现、加载和动态导入
 */

import { Plugin, PluginManager } from '../integration/plugin'
import * as fs from 'fs/promises'
import * as path from 'path'

export interface PluginManifest {
  name: string
  version: string
  description?: string
  main: string
  dependencies?: string[]
  config?: Record<string, unknown>
}

export interface PluginLoaderOptions {
  pluginDirs: string[]
  patterns?: string[]
  autoLoad?: boolean
}

export class PluginLoader {
  private manifestCache = new Map<string, PluginManifest>()
  private pluginModules = new Map<string, unknown>()

  constructor(
    private pluginManager: PluginManager,
    private options: PluginLoaderOptions
  ) {}

  /**
   * 发现插件
   */
  async discover(): Promise<PluginManifest[]> {
    const manifests: PluginManifest[] = []

    for (const dir of this.options.pluginDirs) {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const manifestPath = path.join(dir, entry.name, 'package.json')
            try {
              const content = await fs.readFile(manifestPath, 'utf-8')
              const manifest = JSON.parse(content) as PluginManifest
              if (this.isValidManifest(manifest)) {
                manifests.push(manifest)
                this.manifestCache.set(manifest.name, manifest)
              }
            } catch {
              // 忽略无效的 package.json
            }
          }
        }
      } catch {
        // 忽略无法读取的目录
      }
    }

    return manifests
  }

  /**
   * 加载插件
   */
  async load(manifest: PluginManifest): Promise<Plugin> {
    const pluginPath = path.resolve(
      this.options.pluginDirs[0],
      manifest.name,
      manifest.main
    )

    try {
      // 动态导入插件模块
      const module = await import(pluginPath)
      const PluginClass = module.default || module[manifest.name]

      if (!PluginClass) {
        throw new Error(`No default export or named export '${manifest.name}' found in ${pluginPath}`)
      }

      // 创建插件实例
      const plugin: Plugin = typeof PluginClass === 'function'
        ? new PluginClass()
        : PluginClass

      // 验证插件接口
      if (!this.isValidPlugin(plugin)) {
        throw new Error(`Plugin ${manifest.name} does not implement required interface`)
      }

      this.pluginModules.set(manifest.name, module)
      return plugin
    } catch (error) {
      throw new Error(`Failed to load plugin ${manifest.name}: ${error}`)
    }
  }

  /**
   * 加载所有发现的插件
   */
  async loadAll(): Promise<void> {
    if (!this.options.autoLoad) return

    const manifests = await this.discover()
    for (const manifest of manifests) {
      try {
        const plugin = await this.load(manifest)
        await this.pluginManager.register(plugin)
      } catch (error) {
        console.error(`Failed to load plugin ${manifest.name}:`, error)
      }
    }
  }

  /**
   * 验证清单文件
   */
  private isValidManifest(manifest: unknown): manifest is PluginManifest {
    return (
      typeof manifest === 'object' &&
      manifest !== null &&
      'name' in manifest &&
      'version' in manifest &&
      'main' in manifest &&
      typeof (manifest as PluginManifest).name === 'string' &&
      typeof (manifest as PluginManifest).version === 'string' &&
      typeof (manifest as PluginManifest).main === 'string'
    )
  }

  /**
   * 验证插件接口
   */
  private isValidPlugin(plugin: unknown): plugin is Plugin {
    return (
      typeof plugin === 'object' &&
      plugin !== null &&
      'name' in plugin &&
      'version' in plugin &&
      'boot' in plugin &&
      'shutdown' in plugin &&
      typeof (plugin as Plugin).name === 'string' &&
      typeof (plugin as Plugin).version === 'string' &&
      typeof (plugin as Plugin).boot === 'function' &&
      typeof (plugin as Plugin).shutdown === 'function'
    )
  }

  /**
   * 获取缓存的清单
   */
  getManifest(pluginName: string): PluginManifest | undefined {
    return this.manifestCache.get(pluginName)
  }

  /**
   * 获取插件模块
   */
  getPluginModule(pluginName: string): unknown {
    return this.pluginModules.get(pluginName)
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.manifestCache.clear()
    this.pluginModules.clear()
  }
}

export function createPluginLoader(
  pluginManager: PluginManager,
  options: PluginLoaderOptions
): PluginLoader {
  return new PluginLoader(pluginManager, options)
}