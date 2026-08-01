import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { registerBuiltinTools } from '../builtin'
import { globalToolRegistry } from '../registry'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const TEST_DIR = join(tmpdir(), `licode-glob-test-${Date.now()}`)

beforeAll(async () => {
  await mkdir(TEST_DIR, { recursive: true })
  await mkdir(join(TEST_DIR, 'subdir'), { recursive: true })
  await writeFile(join(TEST_DIR, 'a.ts'), 'const a = 1', 'utf-8')
  await writeFile(join(TEST_DIR, 'b.ts'), 'const b = 2', 'utf-8')
  await writeFile(join(TEST_DIR, 'c.js'), 'const c = 3', 'utf-8')
  await writeFile(join(TEST_DIR, 'subdir', 'd.ts'), 'const d = 4', 'utf-8')
  await writeFile(join(TEST_DIR, '.hidden'), 'hidden', 'utf-8')
  registerBuiltinTools()
})

afterAll(async () => {
  await rm(TEST_DIR, { recursive: true, force: true })
})

describe('glob tool', () => {
  it('匹配 *.ts 文件', async () => {
    const result = await globalToolRegistry.execute('glob', { pattern: '*.ts', path: TEST_DIR })
    expect(result.success).toBe(true)
    expect(result.output).toContain('a.ts')
    expect(result.output).toContain('b.ts')
    expect(result.output).not.toContain('c.js')
  })

  it('匹配 **/*.ts 递归', async () => {
    const result = await globalToolRegistry.execute('glob', { pattern: '**/*.ts', path: TEST_DIR })
    expect(result.success).toBe(true)
    expect(result.output).toContain('a.ts')
    expect(result.output).toContain('d.ts')
  })

  it('无匹配返回提示', async () => {
    const result = await globalToolRegistry.execute('glob', { pattern: '*.md', path: TEST_DIR })
    expect(result.success).toBe(true)
    expect(result.output).toContain('未找到')
  })

  it('无效 pattern 返回错误或空结果', async () => {
    const result = await globalToolRegistry.execute('glob', { pattern: '[invalid', path: TEST_DIR })
    // glob 库可能返回错误或空结果
    if (result.success) {
      expect(result.output).toContain('未找到')
    } else {
      expect(result.error).toBeDefined()
    }
  })

  it('默认使用 cwd', async () => {
    const result = await globalToolRegistry.execute('glob', { pattern: '*.ts' })
    expect(result.success).toBe(true)
  })
})
