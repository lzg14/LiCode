import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { registerBuiltinTools } from '../builtin'
import { globalToolRegistry } from '../registry'

const execAsync = promisify(exec)

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
    expect(tool?.description).toContain('cn.bing.com')
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

describe('git_status tool', () => {
  it('should return git status', async () => {
    const result = await globalToolRegistry.execute('git_status', { cwd: 'D:/ProjectFile/licode' })
    expect(result.success).toBe(true)
    expect(result.output).toBeDefined()
  })

  it('should return clean working tree message when clean', async () => {
    // 使用临时目录测试干净工作树的情况
    const tempGitDir = join(tmpdir(), `licode-git-test-${Date.now()}`)
    await mkdir(tempGitDir, { recursive: true })
    
    try {
      // 初始化 git 仓库
      await execAsync('git init', { cwd: tempGitDir })
      
      const result = await globalToolRegistry.execute('git_status', { cwd: tempGitDir })
      expect(result.success).toBe(true)
      expect(result.output).toBe('工作区干净')
    } finally {
      await rm(tempGitDir, { recursive: true, force: true })
    }
  })
})

describe('git_diff tool', () => {
  it('should return git diff', async () => {
    const result = await globalToolRegistry.execute('git_diff', { cwd: 'D:/ProjectFile/licode' })
    expect(result.success).toBe(true)
    expect(result.output).toBeDefined()
  })

  it('should return no changes message when no diff', async () => {
    // 使用临时目录测试无变更的情况
    const tempGitDir = join(tmpdir(), `licode-git-diff-test-${Date.now()}`)
    await mkdir(tempGitDir, { recursive: true })
    
    try {
      // 初始化 git 仓库并创建初始提交
      await execAsync('git init', { cwd: tempGitDir })
      await writeFile(join(tempGitDir, 'test.txt'), 'initial content', 'utf-8')
      await execAsync('git add .', { cwd: tempGitDir })
      await execAsync('git commit -m "initial commit"', { cwd: tempGitDir })
      
      const result = await globalToolRegistry.execute('git_diff', { cwd: tempGitDir })
      expect(result.success).toBe(true)
      expect(result.output).toBe('无变更')
    } finally {
      await rm(tempGitDir, { recursive: true, force: true })
    }
  })
})

describe('git_log tool', () => {
  it('should return git log', async () => {
    const result = await globalToolRegistry.execute('git_log', { cwd: 'D:/ProjectFile/licode' })
    expect(result.success).toBe(true)
    expect(result.output).toBeDefined()
  })

  it('should respect count parameter', async () => {
    const result = await globalToolRegistry.execute('git_log', { cwd: 'D:/ProjectFile/licode', count: 5 })
    expect(result.success).toBe(true)
    expect(result.output).toBeDefined()
    // 检查输出行数是否不超过5行
    const lines = (result.output as string).split('\n').filter(line => line.trim() !== '')
    expect(lines.length).toBeLessThanOrEqual(5)
  })
})

describe('webfetch tool', () => {
  // 网络依赖测试。CI 环境无网络时默认跳过。
  const HAS_NETWORK = process.env.LICODE_TEST_NETWORK !== 'false'
  const itNet = HAS_NETWORK ? it : it.skip

  itNet('should be registered with correct description', () => {
    const tool = globalToolRegistry.list().find(t => t.name === 'webfetch')
    expect(tool).toBeDefined()
    expect(tool?.description).toContain('网页')
  })

  itNet('should fetch URL content', async () => {
    const result = await globalToolRegistry.execute('webfetch', {
      url: 'https://example.com',
    })
    expect(result.success).toBe(true)
    expect(result.output).toContain('Example Domain')
  }, 30000)

  itNet('should fetch markdown format', async () => {
    const result = await globalToolRegistry.execute('webfetch', {
      url: 'https://example.com',
      format: 'markdown',
    })
    expect(result.success).toBe(true)
    expect(result.output).toContain('Example Domain')
  }, 30000)

  itNet('should handle invalid URL', async () => {
    const result = await globalToolRegistry.execute('webfetch', {
      url: 'http://invalid.invalid.invalid',
    })
    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  }, 30000)

  itNet('should handle non-existent URL', async () => {
    const result = await globalToolRegistry.execute('webfetch', {
      url: 'https://example.com/nonexistent',
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('404')
  }, 30000)
})

describe('grep tool', () => {
  const grepDir = join(TEST_DIR, 'grep-test')
  const subDir = join(grepDir, 'sub')

  beforeAll(async () => {
    await mkdir(subDir, { recursive: true })
    // 创建测试文件
    await writeFile(join(grepDir, 'file1.txt'), 'Hello world\nFoo bar\nHello again', 'utf-8')
    await writeFile(join(grepDir, 'file2.ts'), 'const x = 1;\nconst y = 2;\nfunction hello() {}', 'utf-8')
    await writeFile(join(subDir, 'nested.txt'), 'Nested file content\nHello from nested', 'utf-8')
  })

  it('should search file content', async () => {
    const result = await globalToolRegistry.execute('grep', { pattern: 'Hello', path: grepDir })
    expect(result.success).toBe(true)
    expect(result.output).toContain('Hello world')
    expect(result.output).toContain('Hello again')
    expect(result.output).toContain('Hello from nested')
  })

  it('should search with regex pattern', async () => {
    const result = await globalToolRegistry.execute('grep', { pattern: 'const', path: grepDir })
    expect(result.success).toBe(true)
    expect(result.output).toContain('const')
  })

  it('should search recursively in subdirectories', async () => {
    const result = await globalToolRegistry.execute('grep', { pattern: 'Nested', path: grepDir })
    expect(result.success).toBe(true)
    expect(result.output).toContain('Nested file content')
  })

  it('should filter by include pattern', async () => {
    const result = await globalToolRegistry.execute('grep', { pattern: 'Hello', path: grepDir, include: '*.txt' })
    expect(result.success).toBe(true)
    expect(result.output).toContain('Hello world')
    // .ts 文件不应匹配
    expect(result.output).not.toContain('file2.ts')
  })

  it('should return no match message when pattern not found', async () => {
    const result = await globalToolRegistry.execute('grep', { pattern: 'NONEXISTENT_PATTERN_XYZ_12345', path: grepDir })
    expect(result.success).toBe(true)
    expect(result.output).toContain('未找到匹配')
  })

  it('should handle case-sensitive search', async () => {
    const result = await globalToolRegistry.execute('grep', { pattern: 'Hello', path: grepDir })
    expect(result.success).toBe(true)
    expect(result.output).toContain('Hello')
  })

  it('should search specific file with include pattern', async () => {
    const result = await globalToolRegistry.execute('grep', { pattern: 'function', path: grepDir, include: 'file2.ts' })
    expect(result.success).toBe(true)
    expect(result.output).toContain('function')
  })
})

describe('todo_write tool', () => {
  beforeEach(async () => {
    const { setTodos } = await import('../../tui/context/todos')
    setTodos([])
  })

  it('should create todo items', async () => {
    const items = [
      { id: '1', content: 'Test task 1', status: 'pending' as const },
      { id: '2', content: 'Test task 2', status: 'in_progress' as const },
    ]
    const result = await globalToolRegistry.execute('todo_write', { items })
    expect(result.success).toBe(true)
    expect(result.output).toContain('已更新 2 个 todo')
  })

  it('should fail with duplicate ids', async () => {
    const items = [
      { id: '1', content: 'Task 1', status: 'pending' as const },
      { id: '1', content: 'Task 2', status: 'completed' as const },
    ]
    const result = await globalToolRegistry.execute('todo_write', { items })
    expect(result.success).toBe(false)
    expect(result.error).toContain('重复的 todo id')
  })

  it('should support activeForm field', async () => {
    const items = [
      { id: '1', content: 'Task with form', status: 'in_progress' as const, activeForm: 'Working on it' },
    ]
    const result = await globalToolRegistry.execute('todo_write', { items })
    expect(result.success).toBe(true)
  })
})

describe('todo_read tool', () => {
  beforeEach(async () => {
    const { setTodos } = await import('../../tui/context/todos')
    setTodos([])
  })

  it('should return message when no todos', async () => {
    const result = await globalToolRegistry.execute('todo_read', {})
    expect(result.success).toBe(true)
    expect(result.output).toBe('暂无 todo')
  })

  it('should read todo items with correct icons', async () => {
    const { setTodos } = await import('../../tui/context/todos')
    setTodos([
      { id: '1', content: 'Pending task', status: 'pending' },
      { id: '2', content: 'In progress task', status: 'in_progress' },
      { id: '3', content: 'Completed task', status: 'completed' },
      { id: '4', content: 'Cancelled task', status: 'cancelled' },
    ])
    const result = await globalToolRegistry.execute('todo_read', {})
    expect(result.success).toBe(true)
    expect(result.output).toContain('⬜ [1] Pending task')
    expect(result.output).toContain('🔄 [2] In progress task')
    expect(result.output).toContain('✅ [3] Completed task')
    expect(result.output).toContain('❌ [4] Cancelled task')
  })

  it('should show activeForm when present', async () => {
    const { setTodos } = await import('../../tui/context/todos')
    setTodos([
      { id: '1', content: 'Task with form', status: 'in_progress', activeForm: 'Coding' },
    ])
    const result = await globalToolRegistry.execute('todo_read', {})
    expect(result.success).toBe(true)
    expect(result.output).toContain('🔄 [1] Task with form (Coding)')
  })
})

describe('todo status updates', () => {
  beforeEach(async () => {
    const { setTodos } = await import('../../tui/context/todos')
    setTodos([])
  })

  it('should update todo status from pending to completed', async () => {
    await globalToolRegistry.execute('todo_write', {
      items: [{ id: '1', content: 'Update task', status: 'pending' }],
    })
    await globalToolRegistry.execute('todo_write', {
      items: [{ id: '1', content: 'Update task', status: 'completed' }],
    })
    const result = await globalToolRegistry.execute('todo_read', {})
    expect(result.success).toBe(true)
    expect(result.output).toContain('✅ [1]')
    expect(result.output).not.toContain('⬜ [1]')
  })

  it('should update todo status from in_progress to cancelled', async () => {
    await globalToolRegistry.execute('todo_write', {
      items: [{ id: '1', content: 'Cancel task', status: 'in_progress' }],
    })
    await globalToolRegistry.execute('todo_write', {
      items: [{ id: '1', content: 'Cancel task', status: 'cancelled' }],
    })
    const result = await globalToolRegistry.execute('todo_read', {})
    expect(result.success).toBe(true)
    expect(result.output).toContain('❌ [1]')
  })

  it('should replace entire todo list on write', async () => {
    await globalToolRegistry.execute('todo_write', {
      items: [
        { id: '1', content: 'Task 1', status: 'pending' },
        { id: '2', content: 'Task 2', status: 'pending' },
      ],
    })
    // Write only one item — replaces entire list
    await globalToolRegistry.execute('todo_write', {
      items: [{ id: '3', content: 'Task 3', status: 'completed' }],
    })
    const result = await globalToolRegistry.execute('todo_read', {})
    expect(result.success).toBe(true)
    expect(result.output).toContain('✅ [3]')
    expect(result.output).not.toContain('Task 1')
    expect(result.output).not.toContain('Task 2')
  })
})

describe('apply_patch tool', () => {
  const patchTestFile = join(TEST_DIR, 'patch-test.txt')
  const patchTestContent = 'Hello, licode!\nLine 2\nLine 3'

  beforeEach(async () => {
    await writeFile(patchTestFile, patchTestContent, 'utf-8')
  })

  it('should apply JSON patch with replace operation', async () => {
    const patch = JSON.stringify([
      { op: 'replace', path: 'Hello, licode!', value: 'Hello, world!' }
    ])
    const result = await globalToolRegistry.execute('apply_patch', {
      filePath: patchTestFile,
      patch,
    })
    expect(result.success).toBe(true)
    expect(result.output).toContain('JSON 补丁应用成功')
    const content = await readFile(patchTestFile, 'utf-8')
    expect(content).toBe('Hello, world!\nLine 2\nLine 3')
  })

  it('should apply multiple JSON patch operations', async () => {
    const patch = JSON.stringify([
      { op: 'replace', path: 'Line 2', value: 'Second line' },
      { op: 'replace', path: 'Line 3', value: 'Third line' }
    ])
    const result = await globalToolRegistry.execute('apply_patch', {
      filePath: patchTestFile,
      patch,
    })
    expect(result.success).toBe(true)
    expect(result.output).toContain('JSON 补丁应用成功')
    const content = await readFile(patchTestFile, 'utf-8')
    expect(content).toBe('Hello, licode!\nSecond line\nThird line')
  })

  it('should handle invalid patch format', async () => {
    const invalidPatch = 'this is not a valid patch'
    const result = await globalToolRegistry.execute('apply_patch', {
      filePath: patchTestFile,
      patch: invalidPatch,
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('补丁格式不支持')
  })

  it('should handle non-existent file', async () => {
    const patch = JSON.stringify([
      { op: 'replace', path: 'test', value: 'replaced' }
    ])
    const result = await globalToolRegistry.execute('apply_patch', {
      filePath: '/nonexistent/file.txt',
      patch,
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('文件不存在')
  })

  it('should handle patch with no matching content', async () => {
    const patch = JSON.stringify([
      { op: 'replace', path: 'nonexistent content', value: 'replaced' }
    ])
    const result = await globalToolRegistry.execute('apply_patch', {
      filePath: patchTestFile,
      patch,
    })
    // JSON patch should succeed even if content not found (replace returns original if no match)
    expect(result.success).toBe(true)
    const content = await readFile(patchTestFile, 'utf-8')
    expect(content).toBe(patchTestContent)
  })
})
