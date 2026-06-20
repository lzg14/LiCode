import simpleGit, { type SimpleGit, type StatusResult, type LogResult } from 'simple-git'
import { existsSync } from 'fs'
import { join } from 'path'
import { BaseIntegration, type HealthStatus } from './types'

/**
 * Git 集成 - 使用 simple-git SDK
 */

export class GitIntegration extends BaseIntegration {
  name = 'git'
  private repoPath: string
  private git: SimpleGit

  constructor(repoPath: string) {
    super()
    this.repoPath = repoPath
    this.git = simpleGit(repoPath)
  }

  async connect(): Promise<void> {
    if (existsSync(join(this.repoPath, '.git'))) {
      this.enabled = true
    }
  }

  async disconnect(): Promise<void> {
    this.enabled = false
  }

  async health(): Promise<HealthStatus> {
    try {
      await this.git.status()
      return { healthy: true }
    } catch {
      return { healthy: false, message: 'Git not available' }
    }
  }

  /**
   * 获取状态
   */
  async getStatus(): Promise<{ branch: string; ahead: number; behind: number; dirty: boolean }> {
    const status: StatusResult = await this.git.status()
    return {
      branch: status.current,
      ahead: status.ahead,
      behind: status.behind,
      dirty: status.is_clean() === false,
    }
  }

  /**
   * 获取 diff
   */
  async getDiff(staged = false): Promise<string> {
    if (staged) {
      const diff = await this.git.diff(['--cached'])
      return diff
    }
    const diff = await this.git.diff()
    return diff
  }

  /**
   * 获取 log
   */
  async getLog(count = 10): Promise<{ hash: string; message: string; author: string; date: string }[]> {
    const log: LogResult = await this.git.log({ maxCount: count })
    return log.all.map(entry => ({
      hash: entry.hash,
      message: entry.message,
      author: entry.author_name,
      date: entry.date,
    }))
  }

  /**
   * 暂存文件
   */
  async add(files: string[]): Promise<void> {
    await this.git.add(files)
  }

  /**
   * 提交
   */
  async commit(message: string): Promise<string> {
    const result = await this.git.commit(message)
    return result.commit
  }

  /**
   * 获取分支列表
   */
  async getBranches(): Promise<string[]> {
    const branches = await this.git.branchLocal()
    return branches.all
  }

  /**
   * 安全检查：是否可以执行危险操作
   */
  checkDangerousOperation(command: string): { safe: boolean; reason?: string } {
    const dangerous = [
      { pattern: /push\s+--force/, reason: 'force push 会覆盖远程历史' },
      { pattern: /reset\s+--hard/, reason: 'hard reset 会丢失未提交的更改' },
      { pattern: /clean\s+-f/, reason: 'force clean 会删除未跟踪的文件' },
      { pattern: /branch\s+-D/, reason: '强制删除分支可能丢失未合并的更改' },
    ]

    for (const { pattern, reason } of dangerous) {
      if (pattern.test(command)) {
        return { safe: false, reason }
      }
    }

    return { safe: true }
  }
}
