/**
 * Snapshot 系统 - 文件快照、diff 生成
 * 用于跟踪 Agent 修改的文件
 */

import { execSync } from 'child_process'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, relative } from 'path'
import { randomBytes } from 'crypto'

export interface FileDiff {
  file: string
  patch: string
  additions: number
  deletions: number
  status: 'added' | 'deleted' | 'modified'
}

export interface Snapshot {
  hash: string
  timestamp: number
  files: string[]
  message?: string
}

export class SnapshotManager {
  private snapshotDir: string
  private mainDir: string

  constructor(mainDir: string, snapshotDir?: string) {
    this.mainDir = mainDir
    this.snapshotDir = snapshotDir ?? join(mainDir, '.snapshots')
  }

  /**
   * 创建快照（暂存所有变更）
   */
  track(message?: string): Snapshot | null {
    const status = this.git(['status', '--porcelain'])
    if (!status || status === '') return null

    const hash = randomBytes(8).toString('hex')
    const files = status.split('\n').map(l => l.trim().slice(3)).filter(Boolean)

    // 保存当前 diff
    const diff = this.git(['diff', 'HEAD'])
    const stagedDiff = this.git(['diff', '--cached'])

    const snapshot: Snapshot = {
      hash,
      timestamp: Date.now(),
      files,
      message,
    }

    // 保存快照
    const snapshotPath = join(this.snapshotDir, `${hash}.json`)
    mkdirSync(this.snapshotDir, { recursive: true })
    writeFileSync(snapshotPath, JSON.stringify({
      ...snapshot,
      diff: diff || stagedDiff || '',
    }, null, 2))

    return snapshot
  }

  /**
   * 获取快照的 diff
   */
  getDiff(hash: string): FileDiff[] {
    const snapshotPath = join(this.snapshotDir, `${hash}.json`)
    if (!existsSync(snapshotPath)) return []

    const data = JSON.parse(readFileSync(snapshotPath, 'utf-8'))
    return this.parseDiff(data.diff || '')
  }

  /**
   * 恢复快照
   */
  restore(hash: string): boolean {
    const snapshotPath = join(this.snapshotDir, `${hash}.json`)
    if (!existsSync(snapshotPath)) return false

    const data = JSON.parse(readFileSync(snapshotPath, 'utf-8'))
    if (!data.diff) return false

    // 应用 diff
    try {
      execSync('git apply --reverse', {
        input: data.diff,
        cwd: this.mainDir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      return true
    } catch {
      return false
    }
  }

  /**
   * 生成当前 diff 字符串
   */
  getDiffString(): string {
    return this.git(['diff', 'HEAD']) || ''
  }

  /**
   * 生成两个 hash 之间的完整 diff
   */
  getFullDiff(fromHash: string, toHash: string): FileDiff[] {
    const diff = this.git(['diff', fromHash, toHash])
    return this.parseDiff(diff || '')
  }

  /**
   * 列出所有快照
   */
  list(): Snapshot[] {
    if (!existsSync(this.snapshotDir)) return []

    const { readdirSync } = require('fs')
    const files = readdirSync(this.snapshotDir).filter((f: string) => f.endsWith('.json'))

    return files.map((f: string) => {
      const data = JSON.parse(readFileSync(join(this.snapshotDir, f), 'utf-8'))
      return {
        hash: data.hash,
        timestamp: data.timestamp,
        files: data.files,
        message: data.message,
      }
    }).sort((a: Snapshot, b: Snapshot) => b.timestamp - a.timestamp)
  }

  /**
   * 清理旧快照
   */
  cleanup(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): number {
    const snapshots = this.list()
    const now = Date.now()
    let count = 0

    for (const snapshot of snapshots) {
      if (now - snapshot.timestamp > maxAgeMs) {
        const path = join(this.snapshotDir, `${snapshot.hash}.json`)
        if (existsSync(path)) {
          const { unlinkSync } = require('fs')
          unlinkSync(path)
          count++
        }
      }
    }

    return count
  }

  private git(args: string[]): string {
    try {
      return execSync(`git ${args.join(' ')}`, {
        cwd: this.mainDir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim()
    } catch {
      return ''
    }
  }

  private parseDiff(diff: string): FileDiff[] {
    const files: FileDiff[] = []
    const fileRegex = /^diff --git a\/(.+?) b\/(.+?)$/gm
    let match

    while ((match = fileRegex.exec(diff)) !== null) {
      const file = match[2]
      const fileDiff = diff.slice(match.index)

      // 提取这个文件的 diff
      const nextFile = fileRegex.exec(diff)
      const endIndex = nextFile ? nextFile.index : diff.length
      const patch = diff.slice(match.index, endIndex)

      // 统计增删
      const additions = (patch.match(/^\+[^+]/gm) || []).length
      const deletions = (patch.match(/^-[^-]/gm) || []).length

      let status: FileDiff['status'] = 'modified'
      if (patch.includes('new file mode')) status = 'added'
      else if (patch.includes('deleted file mode')) status = 'deleted'

      files.push({ file, patch, additions, deletions, status })
    }

    return files
  }
}
