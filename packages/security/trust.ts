/**
 * 项目信任机制
 * 
 * 在加载项目级配置前询问用户信任，保存决策到 ~/.licode/trust.json
 * 参考 pi 的 trust 机制
 */

import { readFile, writeFile, access, mkdir } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import { devLogger } from '../core/dev-logger'

/** 信任决策 */
export type TrustDecision = 'trusted' | 'untrusted' | 'ask'

/** 信任记录 */
export interface TrustRecord {
  /** 目录路径 */
  path: string
  /** 信任决策 */
  decision: TrustDecision
  /** 创建时间 */
  createdAt: number
  /** 更新时间 */
  updatedAt: number
  /** 信任的子路径 */
  includeSubdirectories?: boolean
}

/** 信任配置 */
export interface TrustConfig {
  /** 信任记录存储路径 */
  storePath?: string
  /** 默认决策（未记录时） */
  defaultDecision?: TrustDecision
  /** 是否自动信任用户主目录下的项目 */
  trustHomeProjects?: boolean
}

/**
 * 信任管理器
 */
export class TrustManager {
  private records = new Map<string, TrustRecord>()
  private storePath: string
  private defaultDecision: TrustDecision
  private trustHomeProjects: boolean

  constructor(config: TrustConfig = {}) {
    const home = homedir()
    this.storePath = config.storePath ?? join(home, '.licode', 'trust.json')
    this.defaultDecision = config.defaultDecision ?? 'ask'
    this.trustHomeProjects = config.trustHomeProjects ?? true
  }

  /**
   * 初始化加载信任记录
   */
  async init(): Promise<void> {
    try {
      await access(this.storePath)
      const content = await readFile(this.storePath, 'utf-8')
      const data = JSON.parse(content) as TrustRecord[]
      
      for (const record of data) {
        this.records.set(record.path, record)
      }
      
      devLogger.info('TRUST', `Loaded ${this.records.size} trust records`)
    } catch {
      // 文件不存在或解析失败，使用空记录
    }
  }

  /**
   * 保存信任记录
   */
  private async save(): Promise<void> {
    try {
      const dir = this.storePath.substring(0, this.storePath.lastIndexOf('/'))
      await mkdir(dir, { recursive: true })
      
      const data = Array.from(this.records.values())
      await writeFile(this.storePath, JSON.stringify(data, null, 2), 'utf-8')
    } catch (e) {
      devLogger.warn('TRUST', `Failed to save trust records: ${e}`)
    }
  }

  /**
   * 检查目录是否受信任
   */
  async isTrusted(dir: string): Promise<boolean> {
    const decision = await getTrustDecision(dir, this.records, this.trustHomeProjects)
    
    if (decision === 'trusted') {
      return true
    }
    
    if (decision === 'untrusted') {
      return false
    }
    
    // 'ask' 时由调用者决定是否询问
    return false
  }

  /**
   * 获取目录的信任决策
   */
  async getDecision(dir: string): Promise<TrustDecision> {
    return getTrustDecision(dir, this.records, this.trustHomeProjects)
  }

  /**
   * 设置目录的信任决策
   */
  async setDecision(dir: string, decision: TrustDecision, includeSubdirs = false): Promise<void> {
    const now = Date.now()
    const existing = this.records.get(dir)
    
    this.records.set(dir, {
      path: dir,
      decision,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      includeSubdirectories: includeSubdirs,
    })
    
    await this.save()
    devLogger.info('TRUST', `Set trust for ${dir}: ${decision}`)
  }

  /**
   * 删除信任记录
   */
  async removeDecision(dir: string): Promise<void> {
    this.records.delete(dir)
    await this.save()
  }

  /**
   * 获取所有信任记录
   */
  getAll(): TrustRecord[] {
    return Array.from(this.records.values())
  }

  /**
   * 清空所有信任记录
   */
  async clear(): Promise<void> {
    this.records.clear()
    await this.save()
  }
}

/**
 * 获取目录的信任决策（静态方法）
 */
async function getTrustDecision(
  dir: string,
  records: Map<string, TrustRecord>,
  trustHomeProjects: boolean,
): Promise<TrustDecision> {
  // 直接匹配
  const direct = records.get(dir)
  if (direct) {
    return direct.decision
  }

  // 检查父目录（支持 includeSubdirectories）
  const normalizedDir = dir.replace(/\\/g, '/')
  for (const [path, record] of records) {
    const normalizedPath = path.replace(/\\/g, '/')
    
    if (normalizedDir.startsWith(normalizedPath + '/') && record.includeSubdirectories) {
      return record.decision
    }
  }

  // 检查是否在用户主目录下
  const home = homedir()
  const normalizedHome = home.replace(/\\/g, '/')
  
  if (trustHomeProjects && normalizedDir.startsWith(normalizedHome + '/')) {
    return 'trusted'
  }

  return 'ask'
}

/**
 * 交互式信任决策（用于 CLI/TUI）
 */
export async function promptTrustDecision(
  dir: string,
  reason: string,
): Promise<TrustDecision> {
  // 这里应该集成到 TUI 或 CLI 的交互式提示
  // 目前返回默认值
  devLogger.info('TRUST', `Trust prompt for ${dir}: ${reason}`)
  
  // 在实际实现中，这里会显示交互式提示
  // 例如：
  // ┌─────────────────────────────────────────┐
  // │ Trust this project?                     │
  // │ Directory: /path/to/project             │
  // │ Reason: Contains .licode/settings.json  │
  // │                                         │
  // │ [y] Yes, trust this project             │
  // │ [n] No, don't trust                     │
  // │ [a] Always trust this directory         │
  // └─────────────────────────────────────────┘
  
  return 'ask'
}

/**
 * 创建信任管理器单例
 */
let defaultManager: TrustManager | null = null

export function getTrustManager(config?: TrustConfig): TrustManager {
  if (!defaultManager) {
    defaultManager = new TrustManager(config)
  }
  return defaultManager
}

export function resetTrustManager(): void {
  defaultManager = null
}
