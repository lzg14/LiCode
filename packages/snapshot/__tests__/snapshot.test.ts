import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { SnapshotManager } from '../index'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { execSync } from 'child_process'

const TEST_DIR = join(tmpdir(), `licode-snapshot-test-${Date.now()}`)
const SNAPSHOT_DIR = join(TEST_DIR, '.snapshots')

beforeAll(() => {
  mkdirSync(TEST_DIR, { recursive: true })
  execSync('git init', { cwd: TEST_DIR, stdio: 'pipe' })
  writeFileSync(join(TEST_DIR, 'README.md'), '# Test')
  execSync('git add . && git commit -m "init"', { cwd: TEST_DIR, stdio: 'pipe' })
})

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true })
})

describe('SnapshotManager', () => {
  let manager: SnapshotManager

  beforeAll(() => {
    manager = new SnapshotManager(TEST_DIR, SNAPSHOT_DIR)
  })

  it('should track changes', () => {
    writeFileSync(join(TEST_DIR, 'new.txt'), 'hello')
    execSync('git add new.txt', { cwd: TEST_DIR, stdio: 'pipe' })
    const snapshot = manager.track('test snapshot')
    expect(snapshot).not.toBeNull()
    expect(snapshot!.hash).toBeTruthy()
    expect(snapshot!.files).toContain('new.txt')
  })

  it('should list snapshots', () => {
    const list = manager.list()
    expect(list.length).toBeGreaterThanOrEqual(1)
  })

  it('should get diff string', () => {
    writeFileSync(join(TEST_DIR, 'diff.txt'), 'diff content')
    execSync('git add diff.txt', { cwd: TEST_DIR, stdio: 'pipe' })
    const diff = manager.getDiffString()
    expect(diff).toContain('diff.txt')
  })

  it('should cleanup', () => {
    const count = manager.cleanup(0)
    expect(count).toBeGreaterThanOrEqual(0)
  })
})
