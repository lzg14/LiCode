/**
 * Patch 管理
 * 生成、应用和验证文件补丁，支持增量更新
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import * as crypto from 'crypto'

export type PatchOperation = 'add' | 'remove' | 'replace'

export interface PatchHunk {
  oldStart: number
  oldLines: string[]
  newStart: number
  newLines: string[]
}

export interface Patch {
  id: string
  filePath: string
  baseHash: string
  hunks: PatchHunk[]
  timestamp: number
  description?: string
}

export interface PatchResult {
  success: boolean
  applied: number
  failed: number
  errors: PatchError[]
}

export interface PatchError {
  hunkIndex: number
  message: string
  expected?: string
  actual?: string
}

export interface ValidateResult {
  valid: boolean
  conflicts: ConflictInfo[]
}

export interface ConflictInfo {
  hunkIndex: number
  reason: string
  context: string
}

export class PatchManager {
  private storagePath: string

  constructor(storagePath?: string) {
    this.storagePath = storagePath || path.join(process.cwd(), '.patches')
  }

  /**
   * 生成从旧内容到新内容的补丁
   */
  generate(filePath: string, oldContent: string, newContent: string, description?: string): Patch {
    const oldLines = oldContent.split('\n')
    const newLines = newContent.split('\n')
    const hunks = this.computeHunks(oldLines, newLines)

    return {
      id: this.generateId(),
      filePath: path.resolve(filePath),
      baseHash: this.computeHash(oldContent),
      hunks,
      timestamp: Date.now(),
      description,
    }
  }

  /**
   * 生成基于文件当前内容的补丁
   */
  async generateFromFile(
    filePath: string,
    newContent: string,
    description?: string
  ): Promise<Patch> {
    const absolutePath = path.resolve(filePath)
    const oldContent = await fs.readFile(absolutePath, 'utf-8')
    return this.generate(absolutePath, oldContent, newContent, description)
  }

  /**
   * 应用补丁到文件
   */
  async apply(patch: Patch): Promise<PatchResult> {
    const absolutePath = patch.filePath
    let currentContent: string

    try {
      currentContent = await fs.readFile(absolutePath, 'utf-8')
    } catch (error) {
      return {
        success: false,
        applied: 0,
        failed: patch.hunks.length,
        errors: [{
          hunkIndex: 0,
          message: `Failed to read file: ${(error as Error).message}`,
        }],
      }
    }

    const currentHash = this.computeHash(currentContent)
    if (currentHash !== patch.baseHash) {
      return {
        success: false,
        applied: 0,
        failed: patch.hunks.length,
        errors: [{
          hunkIndex: 0,
          message: 'Base hash mismatch - file has been modified since patch creation',
          expected: patch.baseHash,
          actual: currentHash,
        }],
      }
    }

    const currentLines = currentContent.split('\n')
    const result = this.applyHunks(currentLines, patch.hunks)

    if (result.success) {
      const dir = path.dirname(absolutePath)
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(absolutePath, currentLines.join('\n'), 'utf-8')
    }

    return result
  }

  /**
   * 验证补丁是否可以应用
   */
  async validate(patch: Patch): Promise<ValidateResult> {
    const absolutePath = patch.filePath
    let currentContent: string

    try {
      currentContent = await fs.readFile(absolutePath, 'utf-8')
    } catch {
      return {
        valid: false,
        conflicts: [{
          hunkIndex: 0,
          reason: 'File not found',
          context: absolutePath,
        }],
      }
    }

    const currentHash = this.computeHash(currentContent)
    if (currentHash !== patch.baseHash) {
      return {
        valid: false,
        conflicts: [{
          hunkIndex: 0,
          reason: 'Base hash mismatch',
          context: `Expected: ${patch.baseHash}, Got: ${currentHash}`,
        }],
      }
    }

    const currentLines = currentContent.split('\n')
    const conflicts: ConflictInfo[] = []

    for (let i = 0; i < patch.hunks.length; i++) {
      const hunk = patch.hunks[i]
      const match = this.validateHunk(currentLines, hunk)
      if (!match.valid) {
        conflicts.push({
          hunkIndex: i,
          reason: match.reason || 'Context mismatch',
          context: match.context || '',
        })
      }
    }

    return {
      valid: conflicts.length === 0,
      conflicts,
    }
  }

  /**
   * 合并两个补丁
   */
  merge(basePatch: Patch, additionalPatch: Patch): Patch | null {
    if (basePatch.filePath !== additionalPatch.filePath) {
      return null
    }

    const mergedHunks = [...basePatch.hunks]

    for (const hunk of additionalPatch.hunks) {
      const existing = mergedHunks.findIndex(
        m => m.oldStart === hunk.oldStart && m.oldLines.join('\n') === hunk.oldLines.join('\n')
      )

      if (existing === -1) {
        mergedHunks.push(hunk)
      }
    }

    mergedHunks.sort((a, b) => a.oldStart - b.oldStart)

    return {
      id: this.generateId(),
      filePath: basePatch.filePath,
      baseHash: basePatch.baseHash,
      hunks: mergedHunks,
      timestamp: Date.now(),
      description: `Merged: ${basePatch.description || 'patch'} + ${additionalPatch.description || 'patch'}`,
    }
  }

  /**
   * 反转补丁（生成反向补丁）
   */
  reverse(patch: Patch): Patch {
    const reversedHunks = patch.hunks.map(hunk => ({
      oldStart: hunk.newStart,
      oldLines: [...hunk.newLines],
      newStart: hunk.oldStart,
      newLines: [...hunk.oldLines],
    }))

    return {
      id: this.generateId(),
      filePath: patch.filePath,
      baseHash: this.computeHash(patch.newLines.join('\n')),
      hunks: reversedHunks,
      timestamp: Date.now(),
      description: `Reversed: ${patch.description || 'patch'}`,
    }
  }

  /**
   * 持久化补丁到文件
   */
  async save(patch: Patch): Promise<void> {
    await fs.mkdir(this.storagePath, { recursive: true })
    const filepath = path.join(this.storagePath, `${patch.id}.json`)
    await fs.writeFile(filepath, JSON.stringify(patch, null, 2), 'utf-8')
  }

  /**
   * 从文件加载补丁
   */
  async load(patchId: string): Promise<Patch | null> {
    try {
      const filepath = path.join(this.storagePath, `${patchId}.json`)
      const content = await fs.readFile(filepath, 'utf-8')
      return JSON.parse(content)
    } catch {
      return null
    }
  }

  /**
   * 列出所有保存的补丁
   */
  async list(): Promise<Patch[]> {
    try {
      await fs.mkdir(this.storagePath, { recursive: true })
      const files = await fs.readdir(this.storagePath)
      const patches: Patch[] = []

      for (const file of files) {
        if (!file.endsWith('.json')) continue
        try {
          const content = await fs.readFile(path.join(this.storagePath, file), 'utf-8')
          patches.push(JSON.parse(content))
        } catch {
          // 跳过损坏的文件
        }
      }

      return patches.sort((a, b) => a.timestamp - b.timestamp)
    } catch {
      return []
    }
  }

  /**
   * 删除补丁文件
   */
  async delete(patchId: string): Promise<void> {
    const filepath = path.join(this.storagePath, `${patchId}.json`)
    await fs.rm(filepath, { force: true })
  }

  private computeHunks(oldLines: string[], newLines: string[]): PatchHunk[] {
    const hunks: PatchHunk[] = []
    let oldIdx = 0
    let newIdx = 0

    while (oldIdx < oldLines.length || newIdx < newLines.length) {
      if (oldIdx >= oldLines.length) {
        hunks.push({
          oldStart: oldIdx,
          oldLines: [],
          newStart: newIdx,
          newLines: newLines.slice(newIdx),
        })
        break
      }

      if (newIdx >= newLines.length) {
        hunks.push({
          oldStart: oldIdx,
          oldLines: oldLines.slice(oldIdx),
          newStart: newIdx,
          newLines: [],
        })
        break
      }

      if (oldLines[oldIdx] === newLines[newIdx]) {
        oldIdx++
        newIdx++
        continue
      }

      const hunkOldStart = oldIdx
      const hunkNewStart = newIdx
      const oldHunkLines: string[] = []
      const newHunkLines: string[] = []

      while (oldIdx < oldLines.length && newIdx < newLines.length) {
        if (oldLines[oldIdx] === newLines[newIdx]) {
          break
        }
        oldHunkLines.push(oldLines[oldIdx])
        newHunkLines.push(newLines[newIdx])
        oldIdx++
        newIdx++
      }

      if (oldIdx < oldLines.length && newIdx < newLines.length) {
        let contextLines = 0
        const maxContext = 3
        while (
          oldIdx + contextLines < oldLines.length &&
          newIdx + contextLines < newLines.length &&
          oldLines[oldIdx + contextLines] === newLines[newIdx + contextLines] &&
          contextLines < maxContext
        ) {
          contextLines++
        }
        oldIdx += contextLines
        newIdx += contextLines
      }

      hunks.push({
        oldStart: hunkOldStart,
        oldLines: oldHunkLines,
        newStart: hunkNewStart,
        newLines: newHunkLines,
      })
    }

    return hunks
  }

  private applyHunks(
    currentLines: string[],
    hunks: PatchHunk[]
  ): PatchResult {
    const errors: PatchError[] = []
    let applied = 0
    let failed = 0

    for (let i = 0; i < hunks.length; i++) {
      const hunk = hunks[i]
      const validation = this.validateHunk(currentLines, hunk)

      if (!validation.valid) {
        errors.push({
          hunkIndex: i,
          message: validation.reason || 'Context mismatch',
          expected: hunk.oldLines.join('\n'),
          actual: validation.context,
        })
        failed++
        continue
      }

      const startIdx = hunk.oldStart
      currentLines.splice(startIdx, hunk.oldLines.length, ...hunk.newLines)
      applied++
    }

    return {
      success: errors.length === 0,
      applied,
      failed,
      errors,
    }
  }

  private validateHunk(
    currentLines: string[],
    hunk: PatchHunk
  ): { valid: boolean; reason?: string; context?: string } {
    if (hunk.oldLines.length === 0) {
      return { valid: true }
    }

    const startIdx = hunk.oldStart
    if (startIdx + hunk.oldLines.length > currentLines.length) {
      return {
        valid: false,
        reason: 'Hunk extends beyond file end',
        context: `File has ${currentLines.length} lines, hunk starts at ${startIdx}`,
      }
    }

    for (let j = 0; j < hunk.oldLines.length; j++) {
      if (currentLines[startIdx + j] !== hunk.oldLines[j]) {
        return {
          valid: false,
          reason: `Line ${startIdx + j + 1} mismatch`,
          context: `Expected: "${hunk.oldLines[j]}", Got: "${currentLines[startIdx + j]}"`,
        }
      }
    }

    return { valid: true }
  }

  private computeHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16)
  }

  private generateId(): string {
    return crypto.randomBytes(8).toString('hex')
  }

}
