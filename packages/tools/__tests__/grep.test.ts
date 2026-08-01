import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { registerBuiltinTools } from '../builtin'
import { globalToolRegistry } from '../registry'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const TEST_DIR = join(tmpdir(), `licode-grep-test-${Date.now()}`)

beforeAll(async () => {
  await mkdir(TEST_DIR, { recursive: true })
  await writeFile(join(TEST_DIR, 'needle.txt'), 'The quick brown needle jumps\nAnother line\n123 456 789', 'utf-8')
  await writeFile(join(TEST_DIR, 'code.ts'), 'const x = 42\nconst y = "hello"\nfunction test() {}', 'utf-8')
  registerBuiltinTools()
})

afterAll(async () => {
  await rm(TEST_DIR, { recursive: true, force: true })
})

describe('grep tool', () => {
  it('搜索匹配内容', async () => {
    const result = await globalToolRegistry.execute('grep', { pattern: 'needle', path: TEST_DIR })
    expect(result.success).toBe(true)
    expect(result.output).toContain('needle')
  })

  it('正则搜索（字符类语法）', async () => {
    const result = await globalToolRegistry.execute('grep', { pattern: '[0-9]', path: TEST_DIR })
    expect(result.success).toBe(true)
    expect(result.output).toContain('123')
  })

  it('glob 过滤文件', async () => {
    const result = await globalToolRegistry.execute('grep', { pattern: 'const', path: TEST_DIR, include: '*.ts' })
    expect(result.success).toBe(true)
    expect(result.output).toContain('const')
  })

  it('无匹配时返回提示', async () => {
    const result = await globalToolRegistry.execute('grep', { pattern: 'ZZZZZ_NO_MATCH_999', path: TEST_DIR })
    expect(result.success).toBe(true)
    expect(result.output).toContain('未找到匹配')
  })

  it('路径不存在', async () => {
    const result = await globalToolRegistry.execute('grep', { pattern: 'test', path: '/nonexistent/path/xyz' })
    expect(result.success).toBe(true)
    expect(result.output).toContain('未找到匹配')
  })
})
