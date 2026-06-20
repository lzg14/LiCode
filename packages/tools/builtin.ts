import { readFile, writeFile, stat, readdir, mkdir, unlink, copyFile, rename } from 'fs/promises'
import { existsSync } from 'fs'
import { exec, execFile } from 'child_process'
import { promisify } from 'util'
import { glob } from 'glob'
import { join, dirname } from 'path'
import { z } from 'zod'
import { globalToolRegistry } from './registry'

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

export function registerBuiltinTools(): void {
  // ========== 文件操作 ==========

  globalToolRegistry.register({
    name: 'read',
    description: '读取文件内容。支持指定行号范围。',
    inputSchema: z.object({
      path: z.string().describe('文件路径'),
      offset: z.number().optional().describe('起始行号（从1开始）'),
      limit: z.number().optional().describe('读取行数'),
    }),
    handler: async ({ path, offset, limit }) => {
      try {
        let content = await readFile(path, 'utf-8')
        if (offset !== undefined || limit !== undefined) {
          const lines = content.split('\n')
          const start = (offset ?? 1) - 1
          const end = limit !== undefined ? start + limit : lines.length
          content = lines.slice(start, end).join('\n')
        }
        return { success: true, output: content }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    },
  })

  globalToolRegistry.register({
    name: 'write',
    description: '写入内容到文件。如果文件不存在会自动创建。',
    inputSchema: z.object({
      path: z.string().describe('文件路径'),
      content: z.string().describe('要写入的内容'),
    }),
    handler: async ({ path, content }) => {
      try {
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, content, 'utf-8')
        return { success: true, output: `已写入 ${path}` }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    },
  })

  globalToolRegistry.register({
    name: 'edit',
    description: '编辑文件：将 oldString 替换为 newString。支持 replaceAll 替换所有匹配。',
    inputSchema: z.object({
      path: z.string().describe('文件路径'),
      oldString: z.string().describe('要替换的文本'),
      newString: z.string().describe('替换后的文本'),
      replaceAll: z.boolean().optional().describe('是否替换所有匹配'),
    }),
    handler: async ({ path, oldString, newString, replaceAll }) => {
      try {
        if (!existsSync(path)) return { success: false, error: `文件不存在: ${path}` }
        const content = await readFile(path, 'utf-8')
        if (!content.includes(oldString)) return { success: false, error: `在 ${path} 中未找到 oldString` }
        const newContent = replaceAll ? content.split(oldString).join(newString) : content.replace(oldString, newString)
        await writeFile(path, newContent, 'utf-8')
        return { success: true, output: `已编辑 ${path}` }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    },
  })

  globalToolRegistry.register({
    name: 'list_directory',
    description: '列出目录内容。',
    inputSchema: z.object({
      path: z.string().describe('目录路径'),
      recursive: z.boolean().optional().describe('是否递归'),
    }),
    handler: async ({ path, recursive }) => {
      try {
        const items: string[] = []
        const listDir = async (dir: string) => {
          const entries = await readdir(dir, { withFileTypes: true })
          for (const entry of entries) {
            const fullPath = join(dir, entry.name)
            const rel = fullPath.replace(path, '').replace(/^[/\\]/, '')
            items.push(entry.isDirectory() ? `${rel}/` : rel)
            if (recursive && entry.isDirectory()) await listDir(fullPath)
          }
        }
        await listDir(path)
        return { success: true, output: items.join('\n') || '目录为空' }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    },
  })

  globalToolRegistry.register({
    name: 'create_directory',
    description: '创建目录（递归创建）。',
    inputSchema: z.object({ path: z.string().describe('目录路径') }),
    handler: async ({ path }) => {
      try { await mkdir(path, { recursive: true }); return { success: true, output: `已创建 ${path}` } }
      catch (e) { return { success: false, error: String(e) } }
    },
  })

  globalToolRegistry.register({
    name: 'delete_file',
    description: '删除文件。',
    inputSchema: z.object({ path: z.string().describe('文件路径') }),
    handler: async ({ path }) => {
      try { await unlink(path); return { success: true, output: `已删除 ${path}` } }
      catch (e) { return { success: false, error: String(e) } }
    },
  })

  globalToolRegistry.register({
    name: 'move_file',
    description: '移动或重命名文件。',
    inputSchema: z.object({ source: z.string(), destination: z.string() }),
    handler: async ({ source, destination }) => {
      try { await rename(source, destination); return { success: true, output: `${source} → ${destination}` } }
      catch (e) { return { success: false, error: String(e) } }
    },
  })

  globalToolRegistry.register({
    name: 'copy_file',
    description: '复制文件。',
    inputSchema: z.object({ source: z.string(), destination: z.string() }),
    handler: async ({ source, destination }) => {
      try { await copyFile(source, destination); return { success: true, output: `${source} → ${destination}` } }
      catch (e) { return { success: false, error: String(e) } }
    },
  })

  // ========== 搜索 ==========

  globalToolRegistry.register({
    name: 'glob',
    description: '按模式搜索文件（支持 **/*.ts 等通配符）。',
    inputSchema: z.object({ pattern: z.string(), path: z.string().optional() }),
    handler: async ({ pattern, path }) => {
      try {
        const files = await glob(pattern, { cwd: path ?? process.cwd(), ignore: ['node_modules', '.git', 'dist'] })
        return { success: true, output: files.join('\n') || '未找到匹配文件' }
      } catch (e) { return { success: false, error: String(e) } }
    },
  })

  globalToolRegistry.register({
    name: 'grep',
    description: '在文件中搜索内容（正则，跨平台）。优先使用 ripgrep (rg)，自动 fallback 到系统 grep。',
    inputSchema: z.object({ pattern: z.string(), path: z.string(), include: z.string().optional() }),
    handler: async ({ pattern, path, include }) => {
      const cwd = path || process.cwd()
      const tryExec = async (bin: string, args: string[]): Promise<string | null> => {
        try {
          const { stdout } = await execFileAsync(bin, args, { maxBuffer: 1024 * 1024 })
          return stdout
        } catch { return null }
      }

      let stdout = await tryExec('rg', ['-n', pattern, cwd, ...(include ? ['-g', include] : [])])
      if (stdout === null) {
        stdout = await tryExec('grep', ['-rn', '--color=never', ...(include ? [`--include=${include}`] : []), pattern, cwd])
      }
      if (stdout === null) stdout = await tryExec('findstr', ['/s', '/n', '/r', pattern, join(cwd, '*')])
      return { success: true, output: (stdout || '').trim() || '未找到匹配' }
    },
  })

  globalToolRegistry.register({
    name: 'codesearch',
    description: '使用 ripgrep 搜索代码。',
    inputSchema: z.object({ pattern: z.string(), path: z.string().optional(), include: z.string().optional(), maxResults: z.number().default(30) }),
    handler: async ({ pattern, path, include, maxResults }) => {
      try {
        const args = ['-n', '--max-count', String(maxResults)]
        if (include) args.push('-g', include)
        args.push(pattern, path ?? process.cwd())
        const { stdout } = await execFileAsync('rg', args, { maxBuffer: 1024 * 1024 })
        const lines = (stdout || '').split('\n').filter(Boolean).slice(0, maxResults)
        return { success: true, output: lines.join('\n') || '未找到匹配' }
      } catch (e) { return { success: false, error: String(e) } }
    },
  })

  // ========== 系统 ==========

  globalToolRegistry.register({
    name: 'stat',
    description: '获取文件详细信息。',
    inputSchema: z.object({ path: z.string() }),
    handler: async ({ path }) => {
      try {
        const info = await stat(path)
        return { success: true, output: JSON.stringify({ size: info.size, sizeKB: `${(info.size / 1024).toFixed(2)} KB`, mtime: info.mtime.toISOString(), isFile: info.isFile(), isDirectory: info.isDirectory() }, null, 2) }
      } catch (e) { return { success: false, error: String(e) } }
    },
  })

  globalToolRegistry.register({
    name: 'bash',
    description: '执行 shell 命令。',
    inputSchema: z.object({ command: z.string(), cwd: z.string().optional(), timeout: z.number().optional() }),
    handler: async ({ command, cwd, timeout }, ctx) => {
      try {
        const { stdout, stderr } = await execAsync(command, { cwd: cwd ?? ctx.cwd, timeout: timeout ?? 30_000, maxBuffer: 10 * 1024 * 1024 })
        return { success: true, output: stdout || stderr || '完成' }
      } catch (e) { return { success: false, error: e instanceof Error ? e.message : String(e) } }
    },
  })

  globalToolRegistry.register({
    name: 'env_vars',
    description: '获取环境变量。',
    inputSchema: z.object({ name: z.string().optional() }),
    handler: async ({ name }) => {
      if (name) return { success: true, output: process.env[name] ?? `${name} 不存在` }
      return { success: true, output: Object.entries(process.env).map(([k, v]) => `${k}=${v}`).join('\n') }
    },
  })

  // ========== Git ==========

  globalToolRegistry.register({
    name: 'git_status',
    description: '获取 Git 状态。',
    inputSchema: z.object({ cwd: z.string().optional() }),
    handler: async ({ cwd }, ctx) => {
      try { const { stdout } = await execAsync('git status --short', { cwd: cwd ?? ctx.cwd }); return { success: true, output: stdout || '工作区干净' } }
      catch (e) { return { success: false, error: String(e) } }
    },
  })

  globalToolRegistry.register({
    name: 'git_diff',
    description: '获取 Git diff。',
    inputSchema: z.object({ cwd: z.string().optional(), file: z.string().optional(), staged: z.boolean().optional() }),
    handler: async ({ cwd, file, staged }, ctx) => {
      try {
        const cmd = (staged ? 'git diff --staged' : 'git diff') + (file ? ` -- ${file}` : '')
        const { stdout } = await execAsync(cmd, { cwd: cwd ?? ctx.cwd })
        return { success: true, output: stdout || '无变更' }
      } catch (e) { return { success: false, error: String(e) } }
    },
  })

  globalToolRegistry.register({
    name: 'git_log',
    description: '获取 Git 日志。',
    inputSchema: z.object({ cwd: z.string().optional(), count: z.number().default(10) }),
    handler: async ({ cwd, count }, ctx) => {
      try {
        const { stdout } = await execFileAsync('git', ['log', '--oneline', '-n', String(count)], { cwd: cwd ?? ctx.cwd })
        return { success: true, output: stdout || '无记录' }
      } catch (e) { return { success: false, error: String(e) } }
    },
  })

  globalToolRegistry.register({
    name: 'git_commit',
    description: 'Git 提交。',
    inputSchema: z.object({ message: z.string(), cwd: z.string().optional(), files: z.array(z.string()).optional() }),
    handler: async ({ message, cwd, files }, ctx) => {
      try {
        if (files?.length) {
          await execFileAsync('git', ['add', ...files], { cwd: cwd ?? ctx.cwd })
        } else {
          await execFileAsync('git', ['add', '-A'], { cwd: cwd ?? ctx.cwd })
        }
        const { stdout } = await execFileAsync('git', ['commit', '-m', message], { cwd: cwd ?? ctx.cwd })
        return { success: true, output: stdout }
      } catch (e) { return { success: false, error: String(e) } }
    },
  })

  // ========== Web ==========

  globalToolRegistry.register({
    name: 'webfetch',
    description: '获取网页内容。',
    inputSchema: z.object({ url: z.string().url(), format: z.enum(['markdown', 'text', 'html']).default('markdown'), timeout: z.number().optional() }),
    handler: async ({ url, format, timeout }) => {
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeout ?? 15_000)
        const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Licode/0.1.0' } })
        clearTimeout(timer)
        if (!response.ok) return { success: false, error: `HTTP ${response.status}` }
        const body = await response.text()
        if (format === 'html') {
          return { success: true, output: body.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50_000) }
        }
        return { success: true, output: body.slice(0, 50_000) }
      } catch (e) { return { success: false, error: e instanceof Error ? e.message : String(e) } }
    },
  })

  globalToolRegistry.register({
    name: 'websearch',
    description: '搜索网页（cn.bing.com，国内可用）。',
    inputSchema: z.object({ query: z.string(), numResults: z.number().min(1).max(20).default(5) }),
    handler: async ({ query, numResults }) => {
      try {
        const url = `https://cn.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-CN`
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
        })
        if (!response.ok) return { success: false, error: `搜索失败: ${response.status}` }
        const html = await response.text()

        if (/verification|checking your browser|captcha|smartcaptcha/i.test(html)) {
          return { success: false, error: '搜索引擎返回验证页面，请稍后重试' }
        }

        const results: string[] = []
        const algoRe = /<li[^>]+class="[^"]*\bb_algo\b[^"]*"[^>]*>[\s\S]*?<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/gi
        let match
        while ((match = algoRe.exec(html)) !== null && results.length < numResults) {
          const rawHref = match[1]
          const title = match[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
          let href = rawHref
          const bingRedirect = href.match(/^https?:\/\/cn\.bing\.com\/link\?url=([^&]+)/)
          if (bingRedirect) {
            try { href = decodeURIComponent(bingRedirect[1]) } catch {}
          }
          if (title && href && /^https?:\/\//i.test(href)) {
            results.push(`[${title}](${href})`)
          }
        }

        if (results.length === 0) {
          const fallbackRe = /<h2[^>]*>\s*<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/gi
          while ((match = fallbackRe.exec(html)) !== null && results.length < numResults) {
            const title = match[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
            if (title && match[1]) results.push(`[${title}](${match[1]})`)
          }
        }

        return { success: true, output: results.join('\n') || '未找到结果' }
      } catch (e) { return { success: false, error: String(e) } }
    },
  })

  // ========== 开发工具 ==========

  globalToolRegistry.register({
    name: 'run_tests',
    description: '运行项目测试。',
    inputSchema: z.object({ cwd: z.string().optional() }),
    handler: async ({ cwd }, ctx) => {
      try { const { stdout, stderr } = await execAsync('bun test 2>&1 || npx vitest run 2>&1', { cwd: cwd ?? ctx.cwd, timeout: 60_000 }); return { success: true, output: stdout || stderr || '完成' } }
      catch (e) { return { success: false, error: String(e) } }
    },
  })

  globalToolRegistry.register({
    name: 'install_deps',
    description: '安装依赖。',
    inputSchema: z.object({ cwd: z.string().optional(), package: z.string().optional(), dev: z.boolean().optional() }),
    handler: async ({ cwd, package: pkg, dev }, ctx) => {
      try {
        const cmd = pkg ? `bun add ${dev ? '-D ' : ''}${pkg}` : 'bun install'
        const { stdout, stderr } = await execAsync(cmd, { cwd: cwd ?? ctx.cwd, timeout: 120_000 })
        return { success: true, output: stdout || stderr || '完成' }
      } catch (e) { return { success: false, error: String(e) } }
    },
  })

  // ========== 信息 ==========

  globalToolRegistry.register({
    name: 'system_info',
    description: '获取系统信息。',
    inputSchema: z.object({}),
    handler: async () => {
      return { success: true, output: JSON.stringify({ platform: process.platform, arch: process.arch, node: process.version, cwd: process.cwd(), mem: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB` }, null, 2) }
    },
  })

  globalToolRegistry.register({
    name: 'datetime',
    description: '获取当前日期时间。',
    inputSchema: z.object({ format: z.string().optional() }),
    handler: async ({ format }) => {
      const now = new Date()
      if (!format) return { success: true, output: now.toISOString() }
      return { success: true, output: format.replace('YYYY', String(now.getFullYear())).replace('MM', String(now.getMonth() + 1).padStart(2, '0')).replace('DD', String(now.getDate()).padStart(2, '0')).replace('HH', String(now.getHours()).padStart(2, '0')).replace('mm', String(now.getMinutes()).padStart(2, '0')).replace('ss', String(now.getSeconds()).padStart(2, '0')) }
    },
  })
}
