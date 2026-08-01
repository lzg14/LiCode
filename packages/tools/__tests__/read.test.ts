import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { registerBuiltinTools } from '../builtin'
import { globalToolRegistry } from '../registry'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const TEST_DIR = join(tmpdir(), `licode-read-test-${Date.now()}`)

beforeAll(async () => {
  await mkdir(TEST_DIR, { recursive: true })
  registerBuiltinTools()
})

afterAll(async () => {
  await rm(TEST_DIR, { recursive: true, force: true })
})

describe('read tool', () => {
  it('读取文本文件', async () => {
    const filePath = join(TEST_DIR, 'hello.txt')
    await writeFile(filePath, 'Hello, licode!\nLine 2\nLine 3', 'utf-8')
    const result = await globalToolRegistry.execute('read', { path: filePath })
    expect(result.success).toBe(true)
    expect(result.output).toContain('Hello, licode!')
    expect(result.output).toContain('Line 2')
    expect(result.output).toContain('Line 3')
  })

  it('读取不存在的文件', async () => {
    const result = await globalToolRegistry.execute('read', { path: join(TEST_DIR, 'no-such-file.txt') })
    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('读取 + offset/limit', async () => {
    const filePath = join(TEST_DIR, 'multiline.txt')
    const lines = Array.from({ length: 10 }, (_, i) => `Line ${i + 1}`)
    await writeFile(filePath, lines.join('\n'), 'utf-8')
    const result = await globalToolRegistry.execute('read', { path: filePath, offset: 2, limit: 3 })
    expect(result.success).toBe(true)
    expect(result.output).toBe('Line 2\nLine 3\nLine 4')
  })

  it('路径穿越拦截（write/edit 才拦截，read 不受此限制）', async () => {
    const result = await globalToolRegistry.execute('read', { path: '/etc/passwd' })
    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('读取空文件', async () => {
    const filePath = join(TEST_DIR, 'empty.txt')
    await writeFile(filePath, '', 'utf-8')
    const result = await globalToolRegistry.execute('read', { path: filePath })
    expect(result.success).toBe(true)
    expect(result.output).toBe('')
  })

  it('读取大文件不截断', async () => {
    const filePath = join(TEST_DIR, 'big.txt')
    const content = 'A'.repeat(10 * 1024)
    await writeFile(filePath, content, 'utf-8')
    const result = await globalToolRegistry.execute('read', { path: filePath })
    expect(result.success).toBe(true)
    expect((result.output as string).length).toBe(10 * 1024)
  })
})
