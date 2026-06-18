import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { BaseIntegration, type HealthStatus } from './types'

/**
 * Git 集成 - 仓库操作、分支管理、变更追踪
 */

export class GitIntegration extends BaseIntegration {
  name = 'git'
  private repoPath: string

  constructor(repoPath: string) {
    super()
    this.repoPath = repoPath
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
      this.exec('git status')
      return { healthy: true }
    } catch {
      return { healthy: false, message: 'Git not available' }
    }
  }

  /**
   * 执行 git 命令
   */
  private exec(command: string): string {
    return execSync(command, { cwd: this.repoPath, encoding: 'utf-8' }).trim()
  }

  /**
   * 获取状态
   */
  getStatus(): { branch: string; ahead: number; behind: number; dirty: boolean } {
    const branch = this.exec('git branch --show-current')
    const ahead = parseInt(this.exec('git rev-list --count @{u}..HEAD 2>/dev/null || echo 0'))
    const behind = parseInt(this.exec('git rev-list --count HEAD..@{u} 2>/dev/null || echo 0'))
    const dirty = this.exec('git status --porcelain').length > 0

    return { branch, ahead, behind, dirty }
  }

  /**
   * 获取 diff
   */
  getDiff(staged = false): string {
    const flag = staged ? '--cached' : ''
    return this.exec(`git diff ${flag}`)
  }

  /**
   * 获取 log
   */
  getLog(count = 10): { hash: string; message: string; author: string; date: string }[] {
    const output = this.exec(`git log -${count} --format="%H|%s|%an|%ad"`)
    return output.split('\n').filter(Boolean).map(line => {
      const [hash, message, author, date] = line.split('|')
      return { hash, message, author, date }
    })
  }

  /**
   * 暂存文件
   */
  add(files: string[]): void {
    this.exec(`git add ${files.join(' ')}`)
  }

  /**
   * 提交
   */
  commit(message: string): string {
    return this.exec(`git commit -m "${message}"`)
  }

  /**
   * 获取分支列表
   */
  getBranches(): string[] {
    const output = this.exec('git branch --list')
    return output.split('\n').map(b => b.replace('* ', '').trim()).filter(Boolean)
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
