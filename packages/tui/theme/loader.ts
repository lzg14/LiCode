/**
 * 主题加载器
 * 
 * 支持从目录加载主题文件，支持热重载
 */

import { readFile, readdir, access, watch, stat } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import { devLogger } from '../../core/dev-logger'

/** 主题颜色配置 */
export interface ThemeColors {
  primary: string
  error: string
  warning: string
  success: string
  info: string
  text: string
  textMuted: string
  background: string
  backgroundPanel: string
  backgroundElement: string
  border: string
  borderActive: string
  [key: string]: string
}

/** 主题定义 */
export interface Theme {
  /** 主题名称 */
  name: string
  /** 主题模式（dark/light） */
  mode: 'dark' | 'light'
  /** 颜色配置 */
  theme: ThemeColors
  /** 额外定义 */
  defs?: Record<string, string>
}

/** 主题加载选项 */
export interface ThemeLoadOptions {
  /** 全局目录 */
  globalDir?: string
  /** 项目目录 */
  projectDir?: string
  /** 额外目录 */
  extraDirs?: string[]
}

/** 主题变更回调 */
export type ThemeChangeCallback = (theme: Theme) => void

/**
 * 加载单个主题文件
 */
async function loadThemeFile(filePath: string): Promise<Theme | null> {
  try {
    const content = await readFile(filePath, 'utf-8')
    const theme = JSON.parse(content) as Theme
    
    // 验证主题结构
    if (!theme.name || !theme.theme) {
      devLogger.warn('THEME', `Invalid theme structure: ${filePath}`)
      return null
    }
    
    return theme
  } catch (e) {
    devLogger.warn('THEME', `Failed to load theme ${filePath}: ${e}`)
    return null
  }
}

/**
 * 从目录加载所有主题
 */
async function loadFromDir(dir: string): Promise<Map<string, Theme>> {
  const themes = new Map<string, Theme>()
  
  try {
    await access(dir)
  } catch {
    return themes
  }

  try {
    const entries = await readdir(dir)
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue
      const filePath = join(dir, entry)
      const theme = await loadThemeFile(filePath)
      if (theme) {
        themes.set(theme.name, theme)
      }
    }
  } catch (e) {
    devLogger.warn('THEME', `Failed to read directory ${dir}: ${e}`)
  }

  return themes
}

/**
 * 加载所有主题
 */
export async function loadAllThemes(options: ThemeLoadOptions = {}): Promise<Map<string, Theme>> {
  const home = homedir()
  const globalDir = options.globalDir ?? join(home, '.licode', 'themes')
  const projectDir = options.projectDir ?? join(process.cwd(), '.licode', 'themes')

  const allThemes = new Map<string, Theme>()

  // 加载内置主题（default）
  const defaultTheme: Theme = {
    name: 'default',
    mode: 'dark',
    theme: {
      primary: '#89b4fa',
      error: '#f38ba8',
      warning: '#fab387',
      success: '#a6e3a1',
      info: '#89dceb',
      text: '#eeeeee',
      textMuted: '#808080',
      background: '#0a0a0a',
      backgroundPanel: '#141414',
      backgroundElement: '#1e1e1e',
      border: '#484848',
      borderActive: '#89b4fa',
    },
  }
  allThemes.set('default', defaultTheme)

  // 加载全局主题
  const globalThemes = await loadFromDir(globalDir)
  for (const [name, theme] of globalThemes) {
    allThemes.set(name, theme)
  }

  // 加载项目主题
  const projectThemes = await loadFromDir(projectDir)
  for (const [name, theme] of projectThemes) {
    allThemes.set(name, theme)
  }

  // 加载额外目录
  if (options.extraDirs) {
    for (const dir of options.extraDirs) {
      const extraThemes = await loadFromDir(dir)
      for (const [name, theme] of extraThemes) {
        allThemes.set(name, theme)
      }
    }
  }

  devLogger.info('THEME', `Loaded ${allThemes.size} themes`)
  return allThemes
}

/**
 * 查找主题
 */
export async function findTheme(
  name: string,
  options: ThemeLoadOptions = {},
): Promise<Theme | undefined> {
  const themes = await loadAllThemes(options)
  return themes.get(name)
}

/**
 * 主题管理器（支持热重载）
 */
export class ThemeManager {
  private themes = new Map<string, Theme>()
  private currentTheme: Theme | null = null
  private watchers = new Map<string, () => void>()
  private callbacks: ThemeChangeCallback[] = []
  private options: ThemeLoadOptions

  constructor(options: ThemeLoadOptions = {}) {
    this.options = options
  }

  /**
   * 初始化加载所有主题
   */
  async init(): Promise<void> {
    this.themes = await loadAllThemes(this.options)
    // 默认使用 default 主题
    this.currentTheme = this.themes.get('default') ?? null
  }

  /**
   * 获取当前主题
   */
  getCurrent(): Theme | null {
    return this.currentTheme
  }

  /**
   * 获取所有可用主题
   */
  getAll(): Theme[] {
    return Array.from(this.themes.values())
  }

  /**
   * 切换主题
   */
  async set(name: string): Promise<boolean> {
    const theme = this.themes.get(name)
    if (!theme) {
      devLogger.warn('THEME', `Theme not found: ${name}`)
      return false
    }

    this.currentTheme = theme
    this.notifyCallbacks()
    return true
  }

  /**
   * 监听主题变更
   */
  onChange(callback: ThemeChangeCallback): () => void {
    this.callbacks.push(callback)
    return () => {
      this.callbacks = this.callbacks.filter(cb => cb !== callback)
    }
  }

  /**
   * 开始监听主题目录变更（热重载）
   */
  async watchDirs(): Promise<void> {
    const home = homedir()
    const dirs = [
      this.options.globalDir ?? join(home, '.licode', 'themes'),
      this.options.projectDir ?? join(process.cwd(), '.licode', 'themes'),
    ]

    for (const dir of dirs) {
      try {
        await access(dir)
        const watcher = watch(dir, async (eventType) => {
          if (eventType === 'change' || eventType === 'rename') {
            devLogger.info('THEME', `Theme directory changed: ${dir}`)
            // 重新加载主题
            await this.init()
            this.notifyCallbacks()
          }
        })
        this.watchers.set(dir, () => watcher.close())
      } catch {
        // 目录不存在，跳过
      }
    }
  }

  /**
   * 停止监听
   */
  unwatch(): void {
    for (const [dir, unwatch] of this.watchers) {
      unwatch()
    }
    this.watchers.clear()
  }

  private notifyCallbacks(): void {
    if (!this.currentTheme) return
    for (const callback of this.callbacks) {
      try {
        callback(this.currentTheme)
      } catch (e) {
        devLogger.warn('THEME', `Theme change callback failed: ${e}`)
      }
    }
  }
}

/**
 * 创建 light 主题
 */
export function createLightTheme(): Theme {
  return {
    name: 'light',
    mode: 'light',
    theme: {
      primary: '#1e66f5',
      error: '#d20f39',
      warning: '#df8e1d',
      success: '#40a02b',
      info: '#209fb5',
      text: '#4c4f69',
      textMuted: '#9ca0b0',
      background: '#eff1f5',
      backgroundPanel: '#e6e9ef',
      backgroundElement: '#dce0e8',
      border: '#ccd0da',
      borderActive: '#1e66f5',
    },
  }
}
