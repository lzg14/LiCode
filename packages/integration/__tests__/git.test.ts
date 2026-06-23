import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SimpleGit, StatusResult, LogResult } from 'simple-git'

const mockSimpleGit = vi.hoisted(() => {
  const mockInstance = {
    status: vi.fn(),
    diff: vi.fn(),
    log: vi.fn(),
    add: vi.fn(),
    commit: vi.fn(),
    branchLocal: vi.fn(),
  } as unknown as SimpleGit & { [key: string]: ReturnType<typeof vi.fn> }
  const factory = vi.fn(() => mockInstance)
  return { mockInstance, factory }
})

vi.mock('simple-git', () => ({ default: mockSimpleGit.factory }))

const mockExistsSync = vi.hoisted(() => vi.fn())
vi.mock('fs', () => ({ existsSync: mockExistsSync }))

import { existsSync } from 'fs'
import { GitIntegration } from '../git'

const { mockInstance } = mockSimpleGit

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
    vi.mocked(mockInstance.status).mockResolvedValue(undefined)
    const g = new GitIntegration('/r')
    g.enabled = true
    expect((await g.health()).healthy).toBe(true)
  })

  it('health 在 git 失败时 unhealthy', async () => {
    vi.mocked(mockInstance.status).mockRejectedValue(new Error('err'))
    const g = new GitIntegration('/r')
    g.enabled = true
    const h = await g.health()
    expect(h.healthy).toBe(false)
    expect(h.message).toBe('Git not available')
  })

  it('getStatus 正确解析 git 输出', async () => {
    vi.mocked(mockInstance.status).mockResolvedValue({
      current: 'main', ahead: 5, behind: 2, isClean: () => false,
    } as unknown as StatusResult)
    const result = await new GitIntegration('/r').getStatus()
    expect(result).toEqual({ branch: 'main', ahead: 5, behind: 2, dirty: true })
  })

  it('getStatus 无变更状态', async () => {
    vi.mocked(mockInstance.status).mockResolvedValue({
      current: 'f', ahead: 0, behind: 0, isClean: () => true,
    } as unknown as StatusResult)
    const result = await new GitIntegration('/r').getStatus()
    expect(result).toEqual({ branch: 'f', ahead: 0, behind: 0, dirty: false })
  })

  it('getDiff 返回 diff 字符串', async () => {
    vi.mocked(mockInstance.diff).mockResolvedValue('diff --git a/f.ts b/f.ts')
    const result = await new GitIntegration('/r').getDiff()
    expect(result).toContain('diff --git')
  })

  it('getDiff 传入 staged 使用 --cached', async () => {
    vi.mocked(mockInstance.diff).mockResolvedValue('')
    await new GitIntegration('/r').getDiff(true)
    expect(mockInstance.diff).toHaveBeenCalledWith(['--cached'])
  })

  it('getLog 正确解析日志', async () => {
    vi.mocked(mockInstance.log).mockResolvedValue({
      all: [
        { hash: 'abc', message: 'msg', author_name: 'A', date: 'd1' },
        { hash: 'def', message: 'msg2', author_name: 'B', date: 'd2' },
      ],
    } as unknown as LogResult)
    const log = await new GitIntegration('/r').getLog(2)
    expect(log).toHaveLength(2)
    expect(log[0].hash).toBe('abc')
    expect(log[0].message).toBe('msg')
  })

  it('add 暂存文件', async () => {
    await new GitIntegration('/r').add(['a.ts', 'b.ts'])
    expect(mockInstance.add).toHaveBeenCalledWith(['a.ts', 'b.ts'])
  })

  it('commit 执行提交', async () => {
    vi.mocked(mockInstance.commit).mockResolvedValue({ commit: '[main abc123] msg' })
    const r = await new GitIntegration('/r').commit('my message')
    expect(mockInstance.commit).toHaveBeenCalledWith('my message')
    expect(r).toBe('[main abc123] msg')
  })

  it('getBranches 解析分支列表', async () => {
    vi.mocked(mockInstance.branchLocal).mockResolvedValue({ all: ['main', 'dev'] })
    const result = await new GitIntegration('/r').getBranches()
    expect(result).toEqual(['main', 'dev'])
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
