import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { registerBuiltinTools } from '../builtin'
import { globalToolRegistry } from '../registry'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execSync } from 'node:child_process'

const TEST_DIR = join(tmpdir(), `licode-git-test-${Date.now()}`)

beforeAll(async () => {
  await mkdir(TEST_DIR, { recursive: true })
  // 初始化 git 仓库
  execSync('git init', { cwd: TEST_DIR })
  execSync('git config user.email "test@test.com"', { cwd: TEST_DIR })
  execSync('git config user.name "Test"', { cwd: TEST_DIR })
  await writeFile(join(TEST_DIR, 'README.md'), '# Test', 'utf-8')
  execSync('git add .', { cwd: TEST_DIR })
  execSync('git commit -m "init"', { cwd: TEST_DIR })
  registerBuiltinTools()
})

afterAll(async () => {
  await rm(TEST_DIR, { recursive: true, force: true })
})

describe('git_status tool', () => {
  it('获取干净工作区状态', async () => {
    const result = await globalToolRegistry.execute('git_status', { cwd: TEST_DIR })
    expect(result.success).toBe(true)
    expect(result.output).toContain('工作区干净')
  })

  it('获取有变更的状态', async () => {
    await writeFile(join(TEST_DIR, 'new-file.txt'), 'new', 'utf-8')
    const result = await globalToolRegistry.execute('git_status', { cwd: TEST_DIR })
    expect(result.success).toBe(true)
    expect(result.output).toContain('new-file.txt')
    // 清理
    const { unlinkSync } = await import('node:fs')
    unlinkSync(join(TEST_DIR, 'new-file.txt'))
  })

  it('非 git 目录返回错误', async () => {
    const result = await globalToolRegistry.execute('git_status', { cwd: tmpdir() })
    expect(result.success).toBe(false)
  })
})

describe('git_diff tool', () => {
  it('获取 diff', async () => {
    const result = await globalToolRegistry.execute('git_diff', { cwd: TEST_DIR })
    expect(result.success).toBe(true)
  })

  it('获取 staged diff', async () => {
    const result = await globalToolRegistry.execute('git_diff', { cwd: TEST_DIR, staged: true })
    expect(result.success).toBe(true)
  })
})

describe('git_log tool', () => {
  it('获取提交日志', async () => {
    const result = await globalToolRegistry.execute('git_log', { cwd: TEST_DIR, count: 5 })
    expect(result.success).toBe(true)
    expect(result.output).toContain('init')
  })

  it('获取指定数量日志', async () => {
    const result = await globalToolRegistry.execute('git_log', { cwd: TEST_DIR, count: 1 })
    expect(result.success).toBe(true)
  })
})

describe('git_commit tool', () => {
  it('提交变更', async () => {
    await writeFile(join(TEST_DIR, 'commit-test.txt'), 'test', 'utf-8')
    const result = await globalToolRegistry.execute('git_commit', {
      cwd: TEST_DIR,
      message: 'test commit',
      files: ['commit-test.txt'],
    })
    expect(result.success).toBe(true)
    // 验证提交成功
    const status = await globalToolRegistry.execute('git_status', { cwd: TEST_DIR })
    expect(status.output).toContain('工作区干净')
    // 清理
    const { unlinkSync } = await import('node:fs')
    unlinkSync(join(TEST_DIR, 'commit-test.txt'))
    execSync('git reset HEAD~1', { cwd: TEST_DIR })
  })
})
