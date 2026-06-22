import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execSync } from 'child_process'
import { GitIntegration } from '../git'

/**
 * Run a shell command in a working directory, swallowing stderr so test
 * output stays clean. The git CLI on Windows prints harmless warnings
 * (e.g. "hint: Using 'master' as the name for the initial branch") that
 * would otherwise clutter the test report.
 *
 * Args containing whitespace are wrapped in double quotes so multi-word
 * commit messages such as `git commit -m "add a"` survive shell parsing.
 */
function git(cwd: string, ...args: string[]): string {
  const cmd = args
    .map(a => (/\s/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a))
    .join(' ')
  return execSync(`git ${cmd}`, {
    cwd,
    stdio: 'pipe',
    encoding: 'utf-8',
  })
}

describe('GitIntegration', () => {
  let repoPath: string
  let g: GitIntegration

  beforeEach(() => {
    repoPath = mkdtempSync(join(tmpdir(), 'git-test-'))
    // Initialize a real git repo so the integration has a .git folder
    // to discover and a working status/log/diff pipeline to query.
    git(repoPath, 'init', '-q')
    git(repoPath, 'config', 'user.email', 'test@test.com')
    git(repoPath, 'config', 'user.name', 'Test')
    g = new GitIntegration(repoPath)
  })

  afterEach(() => {
    if (existsSync(repoPath)) {
      rmSync(repoPath, { recursive: true, force: true })
    }
  })

  it('connect 在 .git 存在时启用', async () => {
    await g.connect()
    expect(g.enabled).toBe(true)
  })

  it('connect 无 .git 时不启用', async () => {
    // A plain directory without `git init` has no .git folder.
    const noGitDir = mkdtempSync(join(tmpdir(), 'no-git-'))
    try {
      const g2 = new GitIntegration(noGitDir)
      await g2.connect()
      expect(g2.enabled).toBe(false)
    } finally {
      rmSync(noGitDir, { recursive: true, force: true })
    }
  })

  it('disconnect 设置 enabled=false', async () => {
    await g.connect()
    expect(g.enabled).toBe(true)
    await g.disconnect()
    expect(g.enabled).toBe(false)
  })

  it('health 在 git 成功时 healthy', async () => {
    await g.connect()
    const h = await g.health()
    expect(h.healthy).toBe(true)
  })

  it('health 在 git 失败时 unhealthy', async () => {
    // Point at a path that exists but is not a git repo. simple-git's
    // status() call will fail with "not a git repository", which
    // health() maps to { healthy: false, message: 'Git not available' }.
    const plainDir = mkdtempSync(join(tmpdir(), 'not-a-repo-'))
    try {
      const g2 = new GitIntegration(plainDir)
      const h = await g2.health()
      expect(h.healthy).toBe(false)
      expect(h.message).toBe('Git not available')
    } finally {
      rmSync(plainDir, { recursive: true, force: true })
    }
  })

  it('getStatus 正确解析 git 输出', async () => {
    // Create a real file and commit it, then make a local change so the
    // repo is dirty and the status call returns meaningful values.
    writeFileSync(join(repoPath, 'a.txt'), 'hello')
    git(repoPath, 'add', 'a.txt')
    git(repoPath, 'commit', '-q', '-m', 'add a')
    writeFileSync(join(repoPath, 'a.txt'), 'hello modified')

    const s = await new GitIntegration(repoPath).getStatus()
    expect(s.dirty).toBe(true)
    expect(typeof s.branch).toBe('string')
  })

  it('getStatus 干净状态 dirty=false', async () => {
    writeFileSync(join(repoPath, 'clean.txt'), 'content')
    git(repoPath, 'add', 'clean.txt')
    git(repoPath, 'commit', '-q', '-m', 'add clean')

    const s = await new GitIntegration(repoPath).getStatus()
    expect(s.dirty).toBe(false)
  })

  it('getDiff 返回 diff 字符串', async () => {
    writeFileSync(join(repoPath, 'f.txt'), 'v1')
    git(repoPath, 'add', 'f.txt')
    git(repoPath, 'commit', '-q', '-m', 'init')
    writeFileSync(join(repoPath, 'f.txt'), 'v2')

    const diff = await new GitIntegration(repoPath).getDiff()
    expect(diff).toContain('diff --git')
  })

  it('getDiff 传入 staged 使用 --cached', async () => {
    writeFileSync(join(repoPath, 's.txt'), 'staged')
    git(repoPath, 'add', 's.txt')

    const diff = await new GitIntegration(repoPath).getDiff(true)
    // Staged diff for an added file should reference the file path.
    expect(diff).toContain('s.txt')
  })

  it('getLog 正确解析日志', async () => {
    writeFileSync(join(repoPath, 'a.txt'), 'a')
    git(repoPath, 'add', 'a.txt')
    git(repoPath, 'commit', '-q', '-m', 'first')
    writeFileSync(join(repoPath, 'b.txt'), 'b')
    git(repoPath, 'add', 'b.txt')
    git(repoPath, 'commit', '-q', '-m', 'second')

    const log = await new GitIntegration(repoPath).getLog(5)
    expect(log.length).toBeGreaterThanOrEqual(2)
    expect(log[0].message).toBe('second')
    expect(log[1].message).toBe('first')
    expect(log[0].hash).toMatch(/^[0-9a-f]{7,40}$/)
  })

  it('add 暂存文件', async () => {
    writeFileSync(join(repoPath, 'x.txt'), 'x')
    writeFileSync(join(repoPath, 'y.txt'), 'y')
    await new GitIntegration(repoPath).add(['x.txt', 'y.txt'])
    // After add, both files should appear in the staged diff.
    const diff = await new GitIntegration(repoPath).getDiff(true)
    expect(diff).toContain('x.txt')
    expect(diff).toContain('y.txt')
  })

  it('commit 执行提交', async () => {
    writeFileSync(join(repoPath, 'c.txt'), 'c')
    git(repoPath, 'add', 'c.txt')
    const r = await new GitIntegration(repoPath).commit('my message')
    // simple-git returns the short commit SHA in `result.commit`.
    expect(r).toMatch(/^[0-9a-f]{7,40}$/)
    // And the log should now contain the new commit message.
    const log = await new GitIntegration(repoPath).getLog(1)
    expect(log[0].message).toBe('my message')
  })

  it('getBranches 解析分支列表', async () => {
    // `git branch` returns no output for a repo with no commits, so make
    // one commit first to materialise a local branch.
    writeFileSync(join(repoPath, 'init.txt'), 'init')
    git(repoPath, 'add', 'init.txt')
    git(repoPath, 'commit', '-q', '-m', 'initial commit')

    const branches = await new GitIntegration(repoPath).getBranches()
    expect(branches.length).toBeGreaterThanOrEqual(1)
    expect(branches[0]).toBeTruthy()
  })

  it('checkDangerousOperation 检测 push --force', () => {
    const r = new GitIntegration(repoPath).checkDangerousOperation('git push --force origin main')
    expect(r.safe).toBe(false)
    expect(r.reason).toContain('force push')
  })

  it('checkDangerousOperation 检测 reset --hard', () => {
    expect(new GitIntegration(repoPath).checkDangerousOperation('git reset --hard HEAD').safe).toBe(false)
  })

  it('checkDangerousOperation 检测 clean -f 和 branch -D', () => {
    const g2 = new GitIntegration(repoPath)
    expect(g2.checkDangerousOperation('git clean -f').safe).toBe(false)
    expect(g2.checkDangerousOperation('git branch -D x').safe).toBe(false)
  })

  it('checkDangerousOperation 放行安全命令', () => {
    const g2 = new GitIntegration(repoPath)
    expect(g2.checkDangerousOperation('git status').safe).toBe(true)
    expect(g2.checkDangerousOperation('git add .').safe).toBe(true)
    expect(g2.checkDangerousOperation('git commit -m "test"').safe).toBe(true)
  })
})
