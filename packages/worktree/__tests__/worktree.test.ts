import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { WorktreeManager } from '../index'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { execSync } from 'child_process'

const TEST_DIR = join(tmpdir(), `licode-worktree-test-${Date.now()}`)
const MAIN_DIR = join(TEST_DIR, 'main')
const WORKTREE_DIR = join(TEST_DIR, 'worktrees')

beforeAll(() => {
  mkdirSync(MAIN_DIR, { recursive: true })
  execSync('git init', { cwd: MAIN_DIR, stdio: 'pipe' })
  writeFileSync(join(MAIN_DIR, 'README.md'), '# Test')
  execSync('git add . && git commit -m "init"', { cwd: MAIN_DIR, stdio: 'pipe' })
})

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true })
})

describe('WorktreeManager', () => {
  let manager: WorktreeManager

  beforeAll(() => {
    manager = new WorktreeManager(MAIN_DIR, WORKTREE_DIR)
  })

  it('should create worktree', () => {
    const wt = manager.create('test-wt')
    expect(wt.name).toBe('test-wt')
    expect(wt.branch).toBe('licode/test-wt')
    expect(existsSync(wt.directory)).toBe(true)
  })

  it('should list worktrees', () => {
    const list = manager.list()
    expect(list.length).toBeGreaterThanOrEqual(1)
    expect(list.some(w => w.name === 'test-wt')).toBe(true)
  })

  it('should check pristine', () => {
    const wt = manager.create('pristine-wt')
    expect(manager.isPristine(wt.directory)).toBe(true)
  })

  it('should get head', () => {
    const wt = manager.create('head-wt')
    const head = manager.getHead(wt.directory)
    expect(head).toBeTruthy()
    expect(head.length).toBeGreaterThan(0)
  })

  it('should reset worktree', () => {
    const wt = manager.create('reset-wt')
    writeFileSync(join(wt.directory, 'temp.txt'), 'temp')
    expect(manager.isPristine(wt.directory)).toBe(false)

    const result = manager.reset(wt.directory)
    expect(result).toBe(true)
    expect(manager.isPristine(wt.directory)).toBe(true)
  })

  it('should remove worktree', () => {
    const wt = manager.create('remove-wt')
    expect(existsSync(wt.directory)).toBe(true)

    const result = manager.remove(wt.directory)
    expect(result).toBe(true)
    expect(existsSync(wt.directory)).toBe(false)
  })

  it('should throw for non-git repo', () => {
    const badManager = new WorktreeManager('/tmp/nonexistent')
    expect(() => badManager.create()).toThrow('Not a git repository')
  })
})
