import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { registerBuiltinTools } from '../builtin'
import { globalToolRegistry } from '../registry'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const TEST_DIR = join(tmpdir(), `licode-edit-test-${Date.now()}`)

beforeAll(async () => {
  await mkdir(TEST_DIR, { recursive: true })
  registerBuiltinTools()
})

afterAll(async () => {
  await rm(TEST_DIR, { recursive: true, force: true })
})

describe('edit tool', () => {
  const testFile = join(TEST_DIR, 'edit-target.txt')

  beforeEach(async () => {
    await writeFile(testFile, 'hello world hello', 'utf-8')
  })

  it('替换第一处匹配', async () => {
    const result = await globalToolRegistry.execute('edit', { path: testFile, oldString: 'hello', newString: 'world' })
    expect(result.success).toBe(true)
    const content = await readFile(testFile, 'utf-8')
    expect(content).toBe('world world hello')
  })

  it('replaceAll 模式替换所有匹配', async () => {
    await writeFile(testFile, 'foo bar foo baz foo', 'utf-8')
    const result = await globalToolRegistry.execute('edit', { path: testFile, oldString: 'foo', newString: 'bar', replaceAll: true })
    expect(result.success).toBe(true)
    const content = await readFile(testFile, 'utf-8')
    expect(content).toBe('bar bar bar baz bar')
  })

  it('oldString 不匹配时失败', async () => {
    const result = await globalToolRegistry.execute('edit', { path: testFile, oldString: 'not-present', newString: 'x' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('未找到')
  })

  it('编辑不存在的文件失败', async () => {
    const result = await globalToolRegistry.execute('edit', { path: join(TEST_DIR, 'no-such-file.txt'), oldString: 'a', newString: 'b' })
    expect(result.success).toBe(false)
  })

  it('路径穿越拦截', async () => {
    const result = await globalToolRegistry.execute('edit', { path: '/etc/hosts', oldString: '127.0.0.1', newString: 'evil.com' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('拒绝')
  })
})
