/**
 * Git Worktree 管理 - 简化版
 * 支持创建、删除、重置 worktree
 */

import { execSync } from 'child_process'
import { existsSync, rmSync, mkdirSync } from 'fs'
import { join, resolve } from 'path'
import { randomBytes } from 'crypto'

export interface WorktreeInfo {
  name: string
  branch: string
  directory: string
}

export class WorktreeManager {
  private rootDir: string
  private mainDir: string

  constructor(mainDir: string, worktreeRoot?: string) {
    this.mainDir = mainDir
    this.rootDir = worktreeRoot ?? join(mainDir, '.worktrees')
  }

  private git(args: string[], cwd?: string): { code: number; stdout: string; stderr: string } {
    try {
      const stdout = execSync(`git ${args.join(' ')}`, {
        cwd: cwd ?? this.mainDir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      return { code: 0, stdout: stdout.trim(), stderr: '' }
    } catch (e: any) {
      return { code: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }
    }
  }

  private isGitRepo(): boolean {
    return existsSync(join(this.mainDir, '.git'))
  }

  private generateName(): string {
    return `wt-${randomBytes(4).toString('hex')}`
  }

  /**
   * 创建 worktree
   */
  create(name?: string): WorktreeInfo {
    if (!this.isGitRepo()) {
      throw new Error('Not a git repository')
    }

    const wtName = name ?? this.generateName()
    const branch = `licode/${wtName}`
    const directory = join(this.rootDir, wtName)

    if (existsSync(directory)) {
      throw new Error(`Worktree already exists: ${directory}`)
    }

    // 确保 rootDir 存在
    if (!existsSync(this.rootDir)) {
      mkdirSync(this.rootDir, { recursive: true })
    }

    // 创建 worktree
    const result = this.git(['worktree', 'add', '--no-checkout', '-b', branch, directory])
    if (result.code !== 0) {
      throw new Error(`Failed to create worktree: ${result.stderr}`)
    }

    // checkout 文件
    const checkout = this.git(['reset', '--hard'], directory)
    if (checkout.code !== 0) {
      // 清理失败的 worktree
      this.git(['worktree', 'remove', '--force', directory])
      throw new Error(`Failed to checkout worktree: ${checkout.stderr}`)
    }

    return { name: wtName, branch, directory }
  }

  /**
   * 删除 worktree
   */
  remove(directory: string): boolean {
    const dir = resolve(directory)

    // 尝试 git worktree remove
    const result = this.git(['worktree', 'remove', '--force', dir])

    // 如果 git 失败，手动清理
    if (result.code !== 0 && existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true })
    }

    // 删除分支
    const branchResult = this.git(['branch', '-D', this.getBranch(dir)])
    return true
  }

  /**
   * 重置 worktree
   */
  reset(directory: string): boolean {
    const dir = resolve(directory)

    if (!existsSync(dir)) {
      throw new Error(`Worktree not found: ${dir}`)
    }

    // 获取默认分支
    const defaultBranch = this.git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout
    if (!defaultBranch) {
      throw new Error('Cannot determine default branch')
    }

    // 重置
    const reset = this.git(['reset', '--hard', defaultBranch], dir)
    if (reset.code !== 0) {
      throw new Error(`Failed to reset: ${reset.stderr}`)
    }

    // 清理
    const clean = this.git(['clean', '-fdx'], dir)
    return clean.code === 0
  }

  /**
   * 列出所有 worktree
   */
  list(): WorktreeInfo[] {
    const result = this.git(['worktree', 'list', '--porcelain'])
    if (result.code !== 0) return []

    const worktrees: WorktreeInfo[] = []
    const lines = result.stdout.split('\n')
    let current: Partial<WorktreeInfo> = {}

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        current.directory = line.slice('worktree '.length).trim()
      } else if (line.startsWith('branch ')) {
        current.branch = line.slice('branch '.length).trim()
        if (current.directory && current.branch) {
          worktrees.push({
            name: current.branch.split('/').pop() ?? 'unknown',
            branch: current.branch,
            directory: current.directory,
          })
        }
        current = {}
      }
    }

    return worktrees
  }

  /**
   * 检查 worktree 是否干净
   */
  isPristine(directory: string): boolean {
    const result = this.git(['status', '--porcelain'], directory)
    return result.code === 0 && result.stdout === ''
  }

  /**
   * 获取当前 HEAD
   */
  getHead(directory: string): string {
    const result = this.git(['rev-parse', 'HEAD'], directory)
    return result.stdout
  }

  private getBranch(directory: string): string {
    const result = this.git(['rev-parse', '--abbrev-ref', 'HEAD'], directory)
    return result.stdout
  }
}
