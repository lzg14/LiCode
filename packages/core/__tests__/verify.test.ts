import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { verifyDeliverables } from '../verify'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'

const testDir = join(__dirname, '__verify_test_tmp__')

function setup() {
  rmSync(testDir, { force: true, recursive: true })
  mkdirSync(testDir, { recursive: true })
}

function teardown() {
  rmSync(testDir, { force: true, recursive: true })
}

describe('verifyDeliverables', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('file_exists: 文件存在返回 true', async () => {
    writeFileSync(join(testDir, 'foo.txt'), 'hello')
    const results = await verifyDeliverables([
      { path: join(testDir, 'foo.txt'), check: 'file_exists' }
    ])
    expect(results[0].passed).toBe(true)
  })

  it('file_exists: 文件不存在返回 false', async () => {
    const results = await verifyDeliverables([
      { path: join(testDir, 'notexist.txt'), check: 'file_exists' }
    ])
    expect(results[0].passed).toBe(false)
    expect(results[0].message).toContain('notexist.txt')
  })

  it('contains_pattern: 匹配成功返回 true', async () => {
    writeFileSync(join(testDir, 'foo.ts'), 'function calculate() {}')
    const results = await verifyDeliverables([
      { path: join(testDir, 'foo.ts'), check: 'contains_pattern', value: 'function calculate' }
    ])
    expect(results[0].passed).toBe(true)
  })

  it('has_no_import: 无目标 import 返回 true', async () => {
    writeFileSync(join(testDir, 'foo.ts'), "import { foo } from 'bar'")
    const results = await verifyDeliverables([
      { path: join(testDir, 'foo.ts'), check: 'has_no_import', value: 'getUser' }
    ])
    expect(results[0].passed).toBe(true)
  })

  it('has_no_import: 有目标 import 返回 false', async () => {
    writeFileSync(join(testDir, 'foo.ts'), "import { getUser } from 'user'")
    const results = await verifyDeliverables([
      { path: join(testDir, 'foo.ts'), check: 'has_no_import', value: 'getUser' }
    ])
    expect(results[0].passed).toBe(false)
    expect(results[0].message).toContain('getUser')
  })

  it('glob_match: 匹配到文件返回 true', async () => {
    writeFileSync(join(testDir, 'a.ts'), '')
    writeFileSync(join(testDir, 'b.ts'), '')
    // 使用正斜杠（glob 规范）
    const globPattern = testDir.replace(/\\/g, '/') + '/*.ts'
    const results = await verifyDeliverables([
      { glob: globPattern, check: 'glob_match' }
    ])
    expect(results[0].passed).toBe(true)
  })

  it('混合多个 deliverables，全部通过', async () => {
    writeFileSync(join(testDir, 'user.ts'), 'export function getCurrentUser() {}')
    const results = await verifyDeliverables([
      { path: join(testDir, 'user.ts'), check: 'file_exists' },
      { path: join(testDir, 'user.ts'), check: 'contains_pattern', value: 'function getCurrentUser' },
      { path: join(testDir, 'user.ts'), check: 'has_export', value: 'getCurrentUser' },
    ])
    expect(results.every(r => r.passed)).toBe(true)
  })
})
