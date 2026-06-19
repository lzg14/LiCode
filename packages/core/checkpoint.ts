/**
 * Checkpoint 机制
 * 保存和恢复会话状态，支持会话中断后恢复
 */

import * as fs from 'fs/promises'
import * as path from 'path'

export interface SessionCheckpoint {
  sessionId: string
  phase: string
  context: Record<string, unknown>
  timestamp: number
  version: number
  metadata?: {
    userInput?: string
    aiResponse?: string
    effortLevel?: number
  }
}

export interface CheckpointConfig {
  maxCheckpoints?: number
  storagePath?: string
  autoCleanup?: boolean
}

export class CheckpointManager {
  private checkpoints: Map<string, SessionCheckpoint[]> = new Map()
  private storagePath: string
  private maxCheckpoints: number
  private autoCleanup: boolean

  constructor(cwd?: string, config: CheckpointConfig = {}) {
    this.storagePath = config.storagePath || path.join(cwd || process.cwd(), '.checkpoints')
    this.maxCheckpoints = config.maxCheckpoints || 10
    this.autoCleanup = config.autoCleanup ?? true
  }

  /**
   * 保存 checkpoint
   */
  async save(sessionId: string, checkpoint: Omit<SessionCheckpoint, 'sessionId' | 'version'>): Promise<SessionCheckpoint> {
    const sessionCheckpoints = this.checkpoints.get(sessionId) || []
    const version = sessionCheckpoints.length + 1

    const fullCheckpoint: SessionCheckpoint = {
      ...checkpoint,
      sessionId,
      version,
    }

    // 添加到内存
    sessionCheckpoints.push(fullCheckpoint)
    this.checkpoints.set(sessionId, sessionCheckpoints)

    // 持久化到文件
    await this.persistCheckpoint(fullCheckpoint)

    // 清理旧的 checkpoint
    if (this.autoCleanup && sessionCheckpoints.length > this.maxCheckpoints) {
      await this.cleanup(sessionId, sessionCheckpoints.length - this.maxCheckpoints)
    }

    return fullCheckpoint
  }

  /**
   * 恢复最近的 checkpoint
   */
  async restore(sessionId: string): Promise<SessionCheckpoint | null> {
    // 先尝试从内存获取
    const sessionCheckpoints = this.checkpoints.get(sessionId)
    if (sessionCheckpoints?.length) {
      return sessionCheckpoints[sessionCheckpoints.length - 1]
    }

    // 尝试从文件加载
    const loaded = await this.loadCheckpoints(sessionId)
    if (loaded.length > 0) {
      this.checkpoints.set(sessionId, loaded)
      return loaded[loaded.length - 1]
    }

    return null
  }

  /**
   * 获取指定版本的 checkpoint
   */
  async getVersion(sessionId: string, version: number): Promise<SessionCheckpoint | null> {
    const sessionCheckpoints = this.checkpoints.get(sessionId) || []
    return sessionCheckpoints.find(cp => cp.version === version) || null
  }

  /**
   * 列出所有 checkpoint
   */
  async list(sessionId: string): Promise<SessionCheckpoint[]> {
    const sessionCheckpoints = this.checkpoints.get(sessionId) || []
    if (sessionCheckpoints.length === 0) {
      return this.loadCheckpoints(sessionId)
    }
    return sessionCheckpoints
  }

  /**
   * 删除指定 session 的所有 checkpoint
   */
  async delete(sessionId: string): Promise<void> {
    this.checkpoints.delete(sessionId)
    
    const sessionDir = path.join(this.storagePath, sessionId)
    try {
      await fs.rm(sessionDir, { recursive: true, force: true })
    } catch {
      // 忽略删除错误
    }
  }

  /**
   * 持久化 checkpoint 到文件
   */
  private async persistCheckpoint(checkpoint: SessionCheckpoint): Promise<void> {
    try {
      const sessionDir = path.join(this.storagePath, checkpoint.sessionId)
      await fs.mkdir(sessionDir, { recursive: true })

      const filename = `checkpoint-v${checkpoint.version}.json`
      const filepath = path.join(sessionDir, filename)

      await fs.writeFile(filepath, JSON.stringify(checkpoint, null, 2), 'utf-8')
    } catch (error) {
      // 文件操作失败不应阻断主流程
      console.error('Failed to persist checkpoint:', error)
    }
  }

  /**
   * 从文件加载 checkpoints
   */
  private async loadCheckpoints(sessionId: string): Promise<SessionCheckpoint[]> {
    const sessionDir = path.join(this.storagePath, sessionId)
    
    try {
      const files = await fs.readdir(sessionDir)
      const checkpointFiles = files
        .filter(f => f.startsWith('checkpoint-v') && f.endsWith('.json'))
        .sort()

      const checkpoints: SessionCheckpoint[] = []
      for (const file of checkpointFiles) {
        try {
          const content = await fs.readFile(path.join(sessionDir, file), 'utf-8')
          checkpoints.push(JSON.parse(content))
        } catch {
          // 跳过损坏的文件
        }
      }

      return checkpoints
    } catch {
      return []
    }
  }

  /**
   * 清理旧的 checkpoints
   */
  private async cleanup(sessionId: string, count: number): Promise<void> {
    const sessionCheckpoints = this.checkpoints.get(sessionId) || []
    const toRemove = sessionCheckpoints.splice(0, count)
    
    for (const cp of toRemove) {
      const filepath = path.join(
        this.storagePath,
        sessionId,
        `checkpoint-v${cp.version}.json`
      )
      try {
        await fs.rm(filepath, { force: true })
      } catch {
        // 忽略删除错误
      }
    }
  }
}
