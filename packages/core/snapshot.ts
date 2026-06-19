/**
 * 文件快照管理
 * 保存、恢复和比较文件状态，支持原子操作回滚
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import * as crypto from 'crypto'

export interface FileSnapshot {
  id: string
  filePath: string
  content: string
  hash: string
  timestamp: number
  metadata?: Record<string, unknown>
}

export interface SnapshotGroup {
  id: string
  snapshots: FileSnapshot[]
  description?: string
  timestamp: number
}

export interface SnapshotConfig {
  storagePath?: string
  maxSnapshots?: number
  autoCleanup?: boolean
}

export interface DiffResult {
  added: string[]
  removed: string[]
  modified: DiffLine[]
  unchanged: number
}

export interface DiffLine {
  lineNumber: number
  type: 'added' | 'removed' | 'unchanged'
  content: string
}

export class SnapshotManager {
  private storagePath: string
  private maxSnapshots: number
  private autoCleanup: boolean
  private snapshots: Map<string, FileSnapshot[]> = new Map()
  private groups: Map<string, SnapshotGroup> = new Map()

  constructor(config: SnapshotConfig = {}) {
    this.storagePath = config.storagePath || path.join(process.cwd(), '.snapshots')
    this.maxSnapshots = config.maxSnapshots || 50
    this.autoCleanup = config.autoCleanup ?? true
  }

  /**
   * 保存单个文件的快照
   */
  async save(filePath: string, metadata?: Record<string, unknown>): Promise<FileSnapshot> {
    const absolutePath = path.resolve(filePath)
    const content = await fs.readFile(absolutePath, 'utf-8')
    const hash = this.computeHash(content)

    const existingSnapshots = this.snapshots.get(absolutePath) || []
    const existing = existingSnapshots.find(s => s.hash === hash)
    if (existing) {
      return existing
    }

    const snapshot: FileSnapshot = {
      id: this.generateId(),
      filePath: absolutePath,
      content,
      hash,
      timestamp: Date.now(),
      metadata,
    }

    existingSnapshots.push(snapshot)
    this.snapshots.set(absolutePath, existingSnapshots)

    await this.persistSnapshot(snapshot)

    if (this.autoCleanup && existingSnapshots.length > this.maxSnapshots) {
      await this.cleanup(absolutePath, existingSnapshots.length - this.maxSnapshots)
    }

    return snapshot
  }

  /**
   * 保存多个文件的快照组
   */
  async saveGroup(
    filePaths: string[],
    description?: string,
    metadata?: Record<string, unknown>
  ): Promise<SnapshotGroup> {
    const snapshots: FileSnapshot[] = []
    for (const fp of filePaths) {
      snapshots.push(await this.save(fp, metadata))
    }

    const group: SnapshotGroup = {
      id: this.generateId(),
      snapshots,
      description,
      timestamp: Date.now(),
    }

    this.groups.set(group.id, group)
    await this.persistGroup(group)

    return group
  }

  /**
   * 恢复文件到指定快照状态
   */
  async restore(snapshotId: string): Promise<void> {
    const snapshot = this.findSnapshotById(snapshotId)
    if (!snapshot) {
      throw new Error(`Snapshot not found: ${snapshotId}`)
    }

    const dir = path.dirname(snapshot.filePath)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(snapshot.filePath, snapshot.content, 'utf-8')
  }

  /**
   * 恢复整个快照组
   */
  async restoreGroup(groupId: string): Promise<void> {
    const group = this.groups.get(groupId)
    if (!group) {
      throw new Error(`Snapshot group not found: ${groupId}`)
    }

    for (const snapshot of group.snapshots) {
      const dir = path.dirname(snapshot.filePath)
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(snapshot.filePath, snapshot.content, 'utf-8')
    }
  }

  /**
   * 比较文件当前状态与快照的差异
   */
  async diff(snapshotId: string): Promise<DiffResult> {
    const snapshot = this.findSnapshotById(snapshotId)
    if (!snapshot) {
      throw new Error(`Snapshot not found: ${snapshotId}`)
    }

    let currentContent: string
    try {
      currentContent = await fs.readFile(snapshot.filePath, 'utf-8')
    } catch {
      return {
        added: [],
        removed: snapshot.content.split('\n'),
        modified: [],
        unchanged: 0,
      }
    }

    return this.compareContent(snapshot.content, currentContent)
  }

  /**
   * 比较两个文件内容的差异
   */
  compareContent(oldContent: string, newContent: string): DiffResult {
    const oldLines = oldContent.split('\n')
    const newLines = newContent.split('\n')

    const added: string[] = []
    const removed: string[] = []
    const modified: DiffLine[] = []
    let unchanged = 0

    const maxLen = Math.max(oldLines.length, newLines.length)
    for (let i = 0; i < maxLen; i++) {
      const oldLine = oldLines[i]
      const newLine = newLines[i]

      if (oldLine === undefined) {
        added.push(newLine)
        modified.push({ lineNumber: i + 1, type: 'added', content: newLine })
      } else if (newLine === undefined) {
        removed.push(oldLine)
        modified.push({ lineNumber: i + 1, type: 'removed', content: oldLine })
      } else if (oldLine === newLine) {
        unchanged++
      } else {
        removed.push(oldLine)
        added.push(newLine)
        modified.push(
          { lineNumber: i + 1, type: 'removed', content: oldLine },
          { lineNumber: i + 1, type: 'added', content: newLine }
        )
      }
    }

    return { added, removed, modified, unchanged }
  }

  /**
   * 获取文件的所有快照
   */
  async list(filePath?: string): Promise<FileSnapshot[]> {
    if (filePath) {
      const absolutePath = path.resolve(filePath)
      return this.snapshots.get(absolutePath) || await this.loadSnapshots(absolutePath)
    }

    const all: FileSnapshot[] = []
    for (const snapshots of this.snapshots.values()) {
      all.push(...snapshots)
    }
    return all
  }

  /**
   * 获取快照组列表
   */
  listGroups(): SnapshotGroup[] {
    return Array.from(this.groups.values())
  }

  /**
   * 删除指定快照
   */
  async delete(snapshotId: string): Promise<void> {
    for (const [filePath, snapshots] of this.snapshots.entries()) {
      const idx = snapshots.findIndex(s => s.id === snapshotId)
      if (idx !== -1) {
        snapshots.splice(idx, 1)
        if (snapshots.length === 0) {
          this.snapshots.delete(filePath)
        }
        const filepath = path.join(this.storagePath, `${snapshotId}.json`)
        await fs.rm(filepath, { force: true })
        return
      }
    }
  }

  /**
   * 删除快照组
   */
  async deleteGroup(groupId: string): Promise<void> {
    this.groups.delete(groupId)
    const filepath = path.join(this.storagePath, `group-${groupId}.json`)
    await fs.rm(filepath, { force: true })
  }

  /**
   * 检查文件是否已修改（相比最新快照）
   */
  async isModified(filePath: string): Promise<boolean> {
    const absolutePath = path.resolve(filePath)
    const snapshots = this.snapshots.get(absolutePath) || await this.loadSnapshots(absolutePath)
    if (snapshots.length === 0) return true

    const latest = snapshots[snapshots.length - 1]
    let currentContent: string
    try {
      currentContent = await fs.readFile(absolutePath, 'utf-8')
    } catch {
      return true
    }

    return this.computeHash(currentContent) !== latest.hash
  }

  private findSnapshotById(id: string): FileSnapshot | undefined {
    for (const snapshots of this.snapshots.values()) {
      const found = snapshots.find(s => s.id === id)
      if (found) return found
    }
    return undefined
  }

  private computeHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16)
  }

  private generateId(): string {
    return crypto.randomBytes(8).toString('hex')
  }

  private async persistSnapshot(snapshot: FileSnapshot): Promise<void> {
    try {
      await fs.mkdir(this.storagePath, { recursive: true })
      const filepath = path.join(this.storagePath, `${snapshot.id}.json`)
      await fs.writeFile(filepath, JSON.stringify(snapshot, null, 2), 'utf-8')
    } catch (error) {
      console.error('Failed to persist snapshot:', error)
    }
  }

  private async persistGroup(group: SnapshotGroup): Promise<void> {
    try {
      await fs.mkdir(this.storagePath, { recursive: true })
      const filepath = path.join(this.storagePath, `group-${group.id}.json`)
      await fs.writeFile(filepath, JSON.stringify(group, null, 2), 'utf-8')
    } catch (error) {
      console.error('Failed to persist snapshot group:', error)
    }
  }

  private async loadSnapshots(filePath: string): Promise<FileSnapshot[]> {
    try {
      await fs.mkdir(this.storagePath, { recursive: true })
      const files = await fs.readdir(this.storagePath)
      const snapshots: FileSnapshot[] = []

      for (const file of files) {
        if (!file.endsWith('.json') || file.startsWith('group-')) continue
        try {
          const content = await fs.readFile(path.join(this.storagePath, file), 'utf-8')
          const snapshot: FileSnapshot = JSON.parse(content)
          if (snapshot.filePath === filePath) {
            snapshots.push(snapshot)
          }
        } catch {
          // 跳过损坏的文件
        }
      }

      snapshots.sort((a, b) => a.timestamp - b.timestamp)
      this.snapshots.set(filePath, snapshots)
      return snapshots
    } catch {
      return []
    }
  }

  private async cleanup(filePath: string, count: number): Promise<void> {
    const snapshots = this.snapshots.get(filePath) || []
    const toRemove = snapshots.splice(0, count)

    for (const snapshot of toRemove) {
      const filepath = path.join(this.storagePath, `${snapshot.id}.json`)
      try {
        await fs.rm(filepath, { force: true })
      } catch {
        // 忽略删除错误
      }
    }
  }
}
