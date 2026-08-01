import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { exec, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { BaseIntegration, type HealthStatus } from './types'

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

/**
 * Git 集成 - 使用 git CLI（无需 simple-git 依赖）
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
    } else {
      this.enabled = false
    }
  }

  async disconnect(): Promise<void> {
    this.enabled = false
  }

  async health(): Promise<HealthStatus> {
    try {
      await execFileAsync('git', ['status'], { cwd: this.repoPath })
      return { healthy: true }
    } catch {
      return { healthy: false, message: 'Git not available' }
    }
  }

  /**
   * 获取状态
   */
  async getStatus(): Promise<{ branch: string; ahead: number; behind: number; dirty: boolean }> {
    try {
      const { stdout: branch } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: this.repoPath })
      const { stdout: statusOutput } = await execFileAsync('git', ['status', '--porcelain'], { cwd: this.repoPath })
      const { stdout: aheadBehind } = await execFileAsync('git', ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], { cwd: this.repoPath }).catch(() => ({ stdout: '0\t0' }))

      const [ahead, behind] = aheadBehind.trim().split('\t').map(Number)
      const dirty = statusOutput.trim().length > 0

      return {
        branch: branch.trim(),
        ahead: ahead || 0,
        behind: behind || 0,
        dirty,
      }
    } catch {
      return { branch: '', ahead: 0, behind: 0, dirty: false }
    }
  }

  /**
   * 获取 diff
   */
  async getDiff(staged = false): Promise<string> {
    try {
      const args = staged ? ['diff', '--cached'] : ['diff']
      const { stdout } = await execFileAsync('git', args, { cwd: this.repoPath })
      return stdout
    } catch {
      return ''
    }
  }

  /**
   * 获取 log
   */
  async getLog(count = 10): Promise<{ hash: string; message: string; author: string; date: string }[]> {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['log', `--max-count=${count}`, '--pretty=format:%H|%s|%an|%ai'],
        { cwd: this.repoPath }
      )
      return stdout.split('\n').filter(Boolean).map(line => {
        const [hash, message, author, date] = line.split('|')
        return { hash, message, author, date }
      })
    } catch {
      return []
    }
  }

  /**
   * 暂存文件
   */
  async add(files: string[]): Promise<void> {
    await execFileAsync('git', ['add', ...files], { cwd: this.repoPath })
  }

  /**
   * 提交
   */
  async commit(message: string): Promise<string> {
    await execFileAsync('git', ['commit', '-m', message], { cwd: this.repoPath })
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: this.repoPath })
    return stdout.trim().slice(0, 7)
  }

  /**
   * 获取分支列表
   */
  async getBranches(): Promise<string[]> {
    try {
      const { stdout } = await execFileAsync('git', ['branch', '--no-color'], { cwd: this.repoPath })
      return stdout.split('\n').filter(Boolean).map(b => b.replace(/^\*?\s+/, ''))
    } catch {
      return []
    }
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
