import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { registerBuiltinTools } from '../builtin'
import { globalToolRegistry } from '../registry'
import { writeFile, mkdir, rm, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const TEST_DIR = join(tmpdir(), `licode-test-${Date.now()}`)
const TEST_FILE = join(TEST_DIR, 'test.txt')
const TEST_CONTENT = 'Hello, licode!\nLine 2\nLine 3'

beforeAll(async () => {
  await mkdir(TEST_DIR, { recursive: true })
  await writeFile(TEST_FILE, TEST_CONTENT, 'utf-8')
  registerBuiltinTools()
})

afterAll(async () => {
  await rm(TEST_DIR, { recursive: true, force: true })
})

describe('Tool Registry', () => {
  it('should register all built-in tools', () => {
    // 实际数量包含新加的 todo_write/todo_read/apply_patch 等
    // 用容错断言避免每次加工具都要改测试
    expect(globalToolRegistry.list().length).toBeGreaterThanOrEqual(27)
  })

  it('should have all expected tool names', () => {
    const names = globalToolRegistry.list().map(t => t.name)
    expect(names).toContain('read')
    expect(names).toContain('write')
    expect(names).toContain('edit')
    expect(names).toContain('glob')
    expect(names).toContain('grep')
    expect(names).toContain('bash')
    expect(names).toContain('stat')
    expect(names).toContain('list_directory')
    expect(names).toContain('git_status')
    expect(names).toContain('webfetch')
  })
})

describe('read tool', () => {
  it('should read file content', async () => {
    const result = await globalToolRegistry.execute('read', { path: TEST_FILE })
    expect(result.success).toBe(true)
    expect(result.output).toBe(TEST_CONTENT)
  })

  it('should read with offset and limit', async () => {
    const result = await globalToolRegistry.execute('read', { path: TEST_FILE, offset: 2, limit: 1 })
    expect(result.success).toBe(true)
    expect(result.output).toBe('Line 2')
  })

  it('should fail on non-existent file', async () => {
    const result = await globalToolRegistry.execute('read', { path: '/nonexistent/file.txt' })
    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })
})

describe('write tool', () => {
  const testWriteFile = join(TEST_DIR, 'write-test.txt')

  it('should write file content', async () => {
    const result = await globalToolRegistry.execute('write', { path: testWriteFile, content: 'written content' })
    expect(result.success).toBe(true)
    const content = await readFile(testWriteFile, 'utf-8')
    expect(content).toBe('written content')
  })

  it('should create directory if not exists', async () => {
    const deepFile = join(TEST_DIR, 'deep', 'nested', 'file.txt')
    const result = await globalToolRegistry.execute('write', { path: deepFile, content: 'deep' })
    expect(result.success).toBe(true)
    const content = await readFile(deepFile, 'utf-8')
    expect(content).toBe('deep')
  })
})

describe('edit tool', () => {
  const testEditFile = join(TEST_DIR, 'edit-test.txt')

  beforeEach(async () => {
    await writeFile(testEditFile, 'aaa bbb ccc', 'utf-8')
  })

  it('should replace first occurrence', async () => {
    const result = await globalToolRegistry.execute('edit', { path: testEditFile, oldString: 'bbb', newString: 'BBB' })
    expect(result.success).toBe(true)
    const content = await readFile(testEditFile, 'utf-8')
    expect(content).toBe('aaa BBB ccc')
  })

  it('should replace all occurrences when replaceAll is true', async () => {
    await writeFile(testEditFile, 'aaa aaa aaa', 'utf-8')
    const result = await globalToolRegistry.execute('edit', { path: testEditFile, oldString: 'aaa', newString: 'bbb', replaceAll: true })
    expect(result.success).toBe(true)
    const content = await readFile(testEditFile, 'utf-8')
    expect(content).toBe('bbb bbb bbb')
  })

  it('should fail if oldString not found', async () => {
    const result = await globalToolRegistry.execute('edit', { path: testEditFile, oldString: 'xxx', newString: 'yyy' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('未找到')
  })

  it('should fail if file not exists', async () => {
    const result = await globalToolRegistry.execute('edit', { path: '/nonexistent', oldString: 'a', newString: 'b' })
    expect(result.success).toBe(false)
  })
})

describe('list_directory tool', () => {
  it('should list directory contents', async () => {
    const result = await globalToolRegistry.execute('list_directory', { path: TEST_DIR })
    expect(result.success).toBe(true)
    expect(result.output).toContain('test.txt')
  })

  it('should list recursively', async () => {
    const result = await globalToolRegistry.execute('list_directory', { path: TEST_DIR, recursive: true })
    expect(result.success).toBe(true)
  })
})

describe('glob tool', () => {
  it('should find files by pattern', async () => {
    const result = await globalToolRegistry.execute('glob', { pattern: '*.txt', path: TEST_DIR })
    expect(result.success).toBe(true)
    expect(result.output).toContain('test.txt')
  })

  it('should return message when no matches', async () => {
    const result = await globalToolRegistry.execute('glob', { pattern: '*.xyz', path: TEST_DIR })
    expect(result.success).toBe(true)
    expect(result.output).toContain('未找到')
  })
})

describe('stat tool', () => {
  it('should get file info', async () => {
    const result = await globalToolRegistry.execute('stat', { path: TEST_FILE })
    expect(result.success).toBe(true)
    const info = JSON.parse(result.output as string)
    expect(info.isFile).toBe(true)
    expect(info.size).toBeGreaterThan(0)
  })
})

describe('bash tool', () => {
  it('should execute command', async () => {
    const result = await globalToolRegistry.execute('bash', { command: 'echo hello' })
    expect(result.success).toBe(true)
    expect(result.output).toContain('hello')
  })

  it('should fail on invalid command', async () => {
    const result = await globalToolRegistry.execute('bash', { command: 'nonexistent_command_xyz' })
    expect(result.success).toBe(false)
  })
})

describe('create_directory tool', () => {
  it('should create directory', async () => {
    const newDir = join(TEST_DIR, 'new-dir')
    const result = await globalToolRegistry.execute('create_directory', { path: newDir })
    expect(result.success).toBe(true)
    expect(existsSync(newDir)).toBe(true)
  })
})

describe('delete_file tool', () => {
  it('should delete file', async () => {
    const delFile = join(TEST_DIR, 'delete-me.txt')
    await writeFile(delFile, 'delete me', 'utf-8')
    const result = await globalToolRegistry.execute('delete_file', { path: delFile })
    expect(result.success).toBe(true)
    expect(existsSync(delFile)).toBe(false)
  })
})

describe('move_file tool', () => {
  it('should move file', async () => {
    const src = join(TEST_DIR, 'move-src.txt')
    const dst = join(TEST_DIR, 'move-dst.txt')
    await writeFile(src, 'move me', 'utf-8')
    const result = await globalToolRegistry.execute('move_file', { source: src, destination: dst })
    expect(result.success).toBe(true)
    expect(existsSync(src)).toBe(false)
    expect(existsSync(dst)).toBe(true)
  })
})

describe('copy_file tool', () => {
  it('should copy file', async () => {
    const src = join(TEST_DIR, 'copy-src.txt')
    const dst = join(TEST_DIR, 'copy-dst.txt')
    await writeFile(src, 'copy me', 'utf-8')
    const result = await globalToolRegistry.execute('copy_file', { source: src, destination: dst })
    expect(result.success).toBe(true)
    expect(existsSync(src)).toBe(true)
    expect(existsSync(dst)).toBe(true)
  })
})

describe('datetime tool', () => {
  it('should return ISO datetime', async () => {
    const result = await globalToolRegistry.execute('datetime', {})
    expect(result.success).toBe(true)
    expect(result.output).toMatch(/\d{4}-\d{2}-\d{2}T/)
  })

  it('should format datetime', async () => {
    const result = await globalToolRegistry.execute('datetime', { format: 'YYYY-MM-DD' })
    expect(result.success).toBe(true)
    expect(result.output).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('system_info tool', () => {
  it('should return system info', async () => {
    const result = await globalToolRegistry.execute('system_info', {})
    expect(result.success).toBe(true)
    const info = JSON.parse(result.output as string)
    expect(info.platform).toBeDefined()
    expect(info.arch).toBeDefined()
  })
})

describe('env_vars tool', () => {
  it('should get specific env var', async () => {
    const result = await globalToolRegistry.execute('env_vars', { name: 'PATH' })
    expect(result.success).toBe(true)
    expect(result.output).toBeDefined()
  })

  it('should return message for non-existent var', async () => {
    const result = await globalToolRegistry.execute('env_vars', { name: 'NONEXISTENT_VAR_XYZ' })
    expect(result.success).toBe(true)
    expect(result.output).toContain('不存在')
  })
})

describe('input validation', () => {
  it('should reject invalid input', async () => {
    const result = await globalToolRegistry.execute('read', { wrongParam: 'test' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('validation')
  })

  it('should fail for unknown tool', async () => {
    const result = await globalToolRegistry.execute('nonexistent_tool', {})
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })
})

describe('websearch tool (cn.bing.com)', () => {
  // 网络依赖测试。CI 环境无网络时默认跳过。
  const HAS_NETWORK = process.env.LICODE_TEST_NETWORK !== 'false'
  const itNet = HAS_NETWORK ? it : it.skip

  itNet('should be registered with bing description', () => {
    const tool = globalToolRegistry.list().find(t => t.name === 'websearch')
    expect(tool).toBeDefined()
    expect(tool!.description).toContain('cn.bing.com')
  })

  itNet('should return results with title and real URL', async () => {
    const result = await globalToolRegistry.execute('websearch', {
      query: 'licode github',
      numResults: 3,
    })
    expect(result.success).toBe(true)
    const output = String(result.output)
    // 不能是 captcha/verification
    expect(output).not.toContain('verification')
    expect(output).not.toContain('captcha')
    // 必须有 markdown 链接
    const links = output.match(/\[.+?\]\(https?:\/\/.+?\)/g) ?? []
    expect(links.length).toBeGreaterThan(0)
    // 链接不能全是 cn.bing.com 中转
    const realLinks = links.filter(l => !/cn\.bing\.com\/link/.test(l))
    expect(realLinks.length).toBeGreaterThan(0)
  }, 15000)

  itNet('should handle Chinese queries', async () => {
    const result = await globalToolRegistry.execute('websearch', {
      query: '北京天气',
      numResults: 3,
    })
    expect(result.success).toBe(true)
    const output = String(result.output)
    const links = output.match(/\[.+?\]\(https?:\/\/.+?\)/g) ?? []
    expect(links.length).toBeGreaterThan(0)
  }, 15000)
})
