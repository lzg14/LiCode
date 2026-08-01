import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { registerBuiltinTools } from '../builtin'
import { globalToolRegistry } from '../registry'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const TEST_DIR = join(tmpdir(), `licode-write-test-${Date.now()}`)

beforeAll(async () => {
  await mkdir(TEST_DIR, { recursive: true })
  registerBuiltinTools()
})

afterAll(async () => {
  await rm(TEST_DIR, { recursive: true, force: true })
})

describe('write tool', () => {
  it('写入新文件', async () => {
    const filePath = join(TEST_DIR, 'new-file.txt')
    const result = await globalToolRegistry.execute('write', { path: filePath, content: 'test content' })
    expect(result.success).toBe(true)
    const content = await readFile(filePath, 'utf-8')
    expect(content).toBe('test content')
  })

  it('覆盖已有文件', async () => {
    const filePath = join(TEST_DIR, 'overwrite.txt')
    await globalToolRegistry.execute('write', { path: filePath, content: 'version A' })
    const result = await globalToolRegistry.execute('write', { path: filePath, content: 'version B' })
    expect(result.success).toBe(true)
    const content = await readFile(filePath, 'utf-8')
    expect(content).toBe('version B')
  })

  it('写入深目录自动创建中间目录', async () => {
    const deepPath = join(TEST_DIR, 'a', 'b', 'c', 'deep.txt')
    const result = await globalToolRegistry.execute('write', { path: deepPath, content: 'deep content' })
    expect(result.success).toBe(true)
    const content = await readFile(deepPath, 'utf-8')
    expect(content).toBe('deep content')
  })

  it('路径穿越拦截', async () => {
    const result = await globalToolRegistry.execute('write', { path: '/etc/licode-test', content: 'blocked' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('拒绝')
  })

  it('写入中文内容 UTF-8', async () => {
    const filePath = join(TEST_DIR, 'chinese.txt')
    const content = '你好世界！测试中文内容：α β γ'
    const result = await globalToolRegistry.execute('write', { path: filePath, content })
    expect(result.success).toBe(true)
    const actual = await readFile(filePath, 'utf-8')
    expect(actual).toBe(content)
  })
})
