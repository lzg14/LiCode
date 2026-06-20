import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('child_process', () => ({ execSync: vi.fn() }))
vi.mock('fs', () => ({ existsSync: vi.fn() }))

import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { GitIntegration } from '../git'

describe('GitIntegration', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('connect 在 .git 存在时启用', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    const g = new GitIntegration('/r')
    await g.connect()
    expect(g.enabled).toBe(true)
  })

  it('connect 无 .git 时不启用', async () => {
    vi.mocked(existsSync).mockReturnValue(false)
    const g = new GitIntegration('/r')
    await g.connect()
    expect(g.enabled).toBe(false)
  })

  it('disconnect 设置 enabled=false', async () => {
    const g = new GitIntegration('/r')
    g.enabled = true
    await g.disconnect()
    expect(g.enabled).toBe(false)
  })

  it('health 在 git 成功时 healthy', async () => {
    vi.mocked(execSync).mockReturnValue('')
    const g = new GitIntegration('/r')
    g.enabled = true
    expect((await g.health()).healthy).toBe(true)
  })

  it('health 在 git 失败时 unhealthy', async () => {
    vi.mocked(execSync).mockImplementation(() => { throw new Error('err') })
    const g = new GitIntegration('/r')
    g.enabled = true
    const h = await g.health()
    expect(h.healthy).toBe(false)
    expect(h.message).toBe('Git not available')
  })

  it('getStatus 正确解析 git 输出', () => {
    vi.mocked(execSync)
      .mockReturnValueOnce('main').mockReturnValueOnce('5').mockReturnValueOnce('2').mockReturnValueOnce(' M f.ts\n')
    expect(new GitIntegration('/r').getStatus()).toEqual({ branch: 'main', ahead: 5, behind: 2, dirty: true })
  })

  it('getStatus 无变更状态', () => {
    vi.mocked(execSync)
      .mockReturnValueOnce('f').mockReturnValueOnce('0').mockReturnValueOnce('0').mockReturnValueOnce('')
    expect(new GitIntegration('/r').getStatus()).toEqual({ branch: 'f', ahead: 0, behind: 0, dirty: false })
  })

  it('getDiff 返回 diff 字符串', () => {
    vi.mocked(execSync).mockReturnValue('diff --git a/f.ts b/f.ts')
    expect(new GitIntegration('/r').getDiff()).toContain('diff --git')
  })

  it('getDiff 传入 staged 使用 --cached', () => {
    vi.mocked(execSync).mockReturnValue('')
    new GitIntegration('/r').getDiff(true)
    expect(execSync).toHaveBeenCalledWith('git diff --cached', expect.any(Object))
  })

  it('getLog 正确解析日志', () => {
    vi.mocked(execSync).mockReturnValue('abc|msg|A|d1\ndef|msg2|B|d2\n')
    const log = new GitIntegration('/r').getLog(2)
    expect(log).toHaveLength(2)
    expect(log[0].hash).toBe('abc')
    expect(log[0].message).toBe('msg')
  })

  it('add 暂存文件', () => {
    vi.mocked(execSync).mockReturnValue('')
    new GitIntegration('/r').add(['a.ts', 'b.ts'])
    expect(execSync).toHaveBeenCalledWith('git add a.ts b.ts', expect.any(Object))
  })

  it('commit 执行提交', () => {
    vi.mocked(execSync).mockReturnValue('[main abc123] msg')
    const r = new GitIntegration('/r').commit('my message')
    expect(execSync).toHaveBeenCalledWith('git commit -m "my message"', expect.any(Object))
    expect(r).toBe('[main abc123] msg')
  })

  it('getBranches 解析分支列表', () => {
    vi.mocked(execSync).mockReturnValue('* main\n  dev\n')
    expect(new GitIntegration('/r').getBranches()).toEqual(['main', 'dev'])
  })

  it('checkDangerousOperation 检测 push --force', () => {
    const g = new GitIntegration('/r')
    const r = g.checkDangerousOperation('git push --force origin main')
    expect(r.safe).toBe(false)
    expect(r.reason).toContain('force push')
  })

  it('checkDangerousOperation 检测 reset --hard', () => {
    expect(new GitIntegration('/r').checkDangerousOperation('git reset --hard HEAD').safe).toBe(false)
  })

  it('checkDangerousOperation 检测 clean -f 和 branch -D', () => {
    const g = new GitIntegration('/r')
    expect(g.checkDangerousOperation('git clean -f').safe).toBe(false)
    expect(g.checkDangerousOperation('git branch -D x').safe).toBe(false)
  })

  it('checkDangerousOperation 放行安全命令', () => {
    const g = new GitIntegration('/r')
    expect(g.checkDangerousOperation('git status').safe).toBe(true)
    expect(g.checkDangerousOperation('git add .').safe).toBe(true)
    expect(g.checkDangerousOperation('git commit -m "test"').safe).toBe(true)
  })
})
