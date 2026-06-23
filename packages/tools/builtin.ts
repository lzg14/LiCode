import { readFile, writeFile, stat, readdir, mkdir, unlink, copyFile, rename } from 'fs/promises'
import { existsSync, readFileSync } from 'fs'
import { exec, execFile } from 'child_process'
import { promisify } from 'util'
import { glob } from 'glob'
import { join, dirname, resolve, extname } from 'path'
// import { Database } from 'bun:sqlite'  // moved to dynamic import
import { z } from 'zod'
import { globalToolRegistry } from './registry'
import { getSecurityLayer } from '../security'

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

// 支持的图片扩展名
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'])

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
        // 读取旧内容（如果存在）
        let oldContent = ''
        try {
          if (existsSync(path)) {
            oldContent = await readFile(path, 'utf-8')
          }
        } catch { /* 文件不存在时说明是新建，无需读旧内容 */ }

        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, content, 'utf-8')

        // 生成 diff
        const diff: string[] = [`--- a/${path}`, `+++ b/${path}`]
        if (oldContent) {
          const oldLines = oldContent.split('\n')
          const newLines = content.split('\n')
          const maxLines = Math.max(oldLines.length, newLines.length)
          for (let i = 0; i < maxLines; i++) {
            if (oldLines[i] !== newLines[i]) {
              diff.push(`@@ -${i + 1},+${i + 1} @@`)
              if (oldLines[i] !== undefined) diff.push(`-${oldLines[i]}`)
              if (newLines[i] !== undefined) diff.push(`+${newLines[i]}`)
            }
          }
        } else {
          diff.push(`@@ -0,0 +1,${content.split('\n').length} @@`)
          content.split('\n').forEach((line: string) => diff.push(`+${line}`))
        }

        return { success: true, output: `已写入 ${path}`, diff: diff.join('\n') }
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

        // 生成 unified diff
        const oldLines = content.split('\n')
        const newLines = newContent.split('\n')
        const diff: string[] = [`--- a/${path}`, `+++ b/${path}`]
        let oldLineNum = 1
        let newLineNum = 1

        // 简单 diff 算法：找出不同行
        const maxLines = Math.max(oldLines.length, newLines.length)
        for (let i = 0; i < maxLines; i++) {
          const oldLine = oldLines[i]
          const newLine = newLines[i]
          if (oldLine !== newLine) {
            diff.push(`@@ -${oldLineNum},+${newLineNum} @@`)
            if (oldLine !== undefined) diff.push(`-${oldLine}`)
            if (newLine !== undefined) diff.push(`+${newLine}`)
          }
          if (oldLine !== undefined) oldLineNum++
          if (newLine !== undefined) newLineNum++
        }

        return { success: true, output: `已编辑 ${path}`, diff: diff.join('\n') }
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
      // 安全检查：命令白名单
      const cmdCheck = getSecurityLayer().checkCommand(command)
      if (!cmdCheck.allowed) {
        return { success: false, error: cmdCheck.reason ?? '命令被安全策略阻止' }
      }
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

  globalToolRegistry.register({
    name: 'datetime',
    description: '获取当前日期时间。支持简单格式化（YYYY/MM/DD/HH/mm/ss）。',
    inputSchema: z.object({
      format: z.string().optional().describe('格式化字符串'),
    }),
    handler: async ({ format }) => {
      const now = new Date()
      if (!format) return { success: true, output: now.toISOString() }
      const tokens: Record<string, string> = {
        YYYY: String(now.getFullYear()),
        MM: String(now.getMonth() + 1).padStart(2, '0'),
        DD: String(now.getDate()).padStart(2, '0'),
        HH: String(now.getHours()).padStart(2, '0'),
        mm: String(now.getMinutes()).padStart(2, '0'),
        ss: String(now.getSeconds()).padStart(2, '0'),
      }
      let out = format
      for (const [k, v] of Object.entries(tokens)) out = out.replace(new RegExp(k, 'g'), v)
      return { success: true, output: out }
    },
  })

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
    description: '获取当前日期时间。支持自定义格式。',
    inputSchema: z.object({ format: z.string().optional() }),
    handler: async ({ format }) => {
      if (format) {
        const d = new Date()
        const pad = (n: number) => String(n).padStart(2, '0')
        const result = format
          .replace('YYYY', String(d.getFullYear()))
          .replace('MM', pad(d.getMonth() + 1))
          .replace('DD', pad(d.getDate()))
          .replace('HH', pad(d.getHours()))
          .replace('mm', pad(d.getMinutes()))
          .replace('ss', pad(d.getSeconds()))
        return { success: true, output: result }
      }
      return { success: true, output: new Date().toISOString() }
    },
  })

  // ========== Windows 系统 ==========

  globalToolRegistry.register({
    name: 'process_list',
    description: '列出运行中的进程（Windows tasklist）。支持按名称过滤。',
    inputSchema: z.object({
      filter: z.string().optional().describe('进程名过滤（如 "node", "code"）'),
      limit: z.number().optional().describe('最多显示行数，默认50'),
    }),
    handler: async ({ filter, limit }) => {
      try {
        const cmd = filter ? `tasklist /FI "IMAGENAME eq ${filter}*" /FO CSV /NH` : 'tasklist /FO CSV /NH'
        const { stdout } = await execAsync(cmd, { timeout: 10000 })
        const lines = stdout.trim().split('\n').filter(Boolean)
        const result = limit ? lines.slice(0, limit) : lines.slice(0, 50)
        return { success: true, output: result.join('\n') || '无匹配进程' }
      } catch (e) { return { success: false, error: String(e) } }
    },
  })

  globalToolRegistry.register({
    name: 'kill_process',
    description: '结束指定进程（Windows taskkill）。',
    inputSchema: z.object({
      pid: z.number().describe('进程 ID'),
      force: z.boolean().optional().describe('强制结束，默认false'),
    }),
    handler: async ({ pid, force }) => {
      try {
        const flag = force ? '/F' : ''
        const { stdout } = await execAsync(`taskkill ${flag} /PID ${pid}`, { timeout: 5000 })
        return { success: true, output: stdout || `进程 ${pid} 已结束` }
      } catch (e) { return { success: false, error: String(e) } }
    },
  })

  globalToolRegistry.register({
    name: 'open_explorer',
    description: '在 Windows 资源管理器中打开指定路径。',
    inputSchema: z.object({
      path: z.string().describe('文件或目录路径'),
      select: z.boolean().optional().describe('是否选中文件'),
    }),
    handler: async ({ path, select }) => {
      try {
        const absPath = resolve(path)
        const cmd = select ? `explorer /select,"${absPath}"` : `explorer "${absPath}"`
        await execAsync(cmd, { timeout: 3000 })
        return { success: true, output: `已在资源管理器中打开: ${absPath}` }
      } catch (e) { return { success: false, error: String(e) } }
    },
  })

  globalToolRegistry.register({
    name: 'open_url',
    description: '在默认浏览器中打开 URL。',
    inputSchema: z.object({
      url: z.string().describe('URL 地址'),
    }),
    handler: async ({ url }) => {
      try {
        const cmd = process.platform === 'win32' ? `start "" "${url}"` : `open "${url}"`
        await execAsync(cmd, { timeout: 3000 })
        return { success: true, output: `已在浏览器中打开: ${url}` }
      } catch (e) { return { success: false, error: String(e) } }
    },
  })

  globalToolRegistry.register({
    name: 'gh',
    description: '执行 GitHub CLI (gh) 命令。自动在 git root 目录执行。用途：查看 PR/issue、创建 PR、查看 repo 信息等。',
    inputSchema: z.object({
      args: z.string().describe('gh 命令参数，如 "pr list --state open --limit 10"'),
      timeout: z.number().optional().describe('超时秒数，默认30秒'),
    }),
    handler: async ({ args, timeout }, ctx) => {
      try {
        const { stdout, stderr } = await execAsync(`gh ${args}`, { cwd: ctx.cwd, timeout: (timeout ?? 30) * 1000 })
        const output = stdout || stderr || '命令执行完成（无输出）'
        return { success: true, output }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (msg.includes('not found')) {
          return { success: false, error: 'gh.exe 未安装。请从 https://cli.github.com 安装 GitHub CLI。' }
        }
        return { success: false, error: msg }
      }
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
        const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Licode/0.2.0' } })
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
            try { href = decodeURIComponent(bingRedirect[1]) } catch { /* URL 解码失败，使用原始 href */ }
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

  // ========== 开发辅助 ==========

  globalToolRegistry.register({
    name: 'format',
    description: '格式化代码。自动检测项目配置（prettier / dprint / biome），回退到通用格式化。',
    inputSchema: z.object({
      path: z.string().describe('要格式化的文件或目录路径'),
      cwd: z.string().optional().describe('工作目录'),
      check: z.boolean().optional().describe('仅检查是否已格式化，不修改文件'),
    }),
    handler: async ({ path, cwd, check }, ctx) => {
      const workDir = cwd ?? ctx.cwd
      const tryRun = async (cmd: string): Promise<string | null> => {
        try {
          const { stdout, stderr } = await execAsync(cmd, { cwd: workDir, timeout: 30_000 })
          return (stdout || stderr || '').trim()
        } catch { return null }
      }
      const flag = check ? '--check' : '--write'
      const cmds = [
        `bun run format ${flag} "${path}" 2>&1`,
        `npx prettier ${flag} "${path}" 2>&1`,
        `npx dprint ${flag} "${path}" 2>&1`,
        `bun x @biomejs/biome format ${flag} "${path}" 2>&1`,
      ]
      for (const c of cmds) {
        const out = await tryRun(c)
        if (out !== null) return { success: true, output: out || '格式化完成' }
      }
      return { success: true, output: '未找到格式化工具，请先配置 prettier/dprint/biome' }
    },
  })

  globalToolRegistry.register({
    name: 'lint',
    description: '运行代码检查。自动检测项目配置（eslint / ruff / biome），回退到 tsconfig 检查。',
    inputSchema: z.object({
      path: z.string().optional().describe('要检查的文件或目录路径'),
      cwd: z.string().optional().describe('工作目录'),
      fix: z.boolean().optional().describe('是否自动修复问题'),
    }),
    handler: async ({ path, cwd, fix }, ctx) => {
      const workDir = cwd ?? ctx.cwd
      const tryRun = async (cmd: string): Promise<string | null> => {
        try {
          const { stdout, stderr } = await execAsync(cmd, { cwd: workDir, timeout: 60_000 })
          return (stdout || stderr || '').trim()
        } catch (e: any) { return e?.stdout || e?.stderr || e?.message || String(e) }
      }
      const fixFlag = fix ? '--fix' : ''
      const cmds = [
        `npx tsc --noEmit --skipLibCheck 2>&1`,
        `npx eslint ${fixFlag} "${path ?? '.'}" 2>&1`,
        `bunx eslint ${fixFlag} "${path ?? '.'}" 2>&1`,
        `ruff check ${fixFlag} ${path ?? '.'} 2>&1`,
        `npx @biomejs/biome lint ${fixFlag} "${path ?? '.'}" 2>&1`,
      ]
      for (const cmd of cmds) {
        const out = await tryRun(cmd)
        if (out) return { success: true, output: out }
      }
      return { success: true, output: '未发现问题' }
    },
  })

  // ========== 技能 ==========

  globalToolRegistry.register({
    name: 'skill',
    description: '加载并执行技能。技能是位于 ~/.licode/skills/ 或项目 skills/ 目录下的 .skill.json / .skill.md 文件，包含专业知识和工作流程。',
    inputSchema: z.object({
      name: z.string().describe('技能名称'),
      args: z.record(z.string(), z.unknown()).optional().describe('传递给技能的参数'),
    }),
    handler: async ({ name, args }) => {
      const home = process.env.HOME || process.env.USERPROFILE || ''
      const skillDirs = [
        join(home, '.licode', 'skills'),
        join(home, '.licode', 'skills', 'builtin'),
        join(process.cwd(), 'skills'),
      ]

      // 加载技能
      const { skillLoader } = await import('../skills/loader')
      for (const dir of skillDirs) {
        await skillLoader.loadFromDir(dir)
      }

      // 查找技能
      const { globalSkillRegistry } = await import('../skills/registry')
      const skill = globalSkillRegistry.findByName(name)
      if (!skill) {
        const loaded = globalSkillRegistry.list().map(s => s.name).join(', ')
        return { success: false, error: `技能 "${name}" 未找到。已加载: ${loaded || '(无)'}。搜索路径: ${skillDirs.join(', ')}` }
      }

      // 返回 skill instructions，由 LLM 按指令执行
      return {
        success: true,
        output: `## 技能已激活: ${skill.name}\n\n${skill.instructions}`,
      }
    },
  })

  // ========== 数据库 ==========

  globalToolRegistry.register({
    name: 'database_query',
    description: '对 SQLite 数据库执行查询（SELECT / INSERT / UPDATE / DELETE / PRAGMA）。支持只读模式防止意外修改。',
    inputSchema: z.object({
      path: z.string().describe('数据库文件路径'),
      sql: z.string().describe('SQL 语句'),
      params: z.array(z.unknown()).optional().describe('参数化查询的参数'),
      readonly: z.boolean().default(true).describe('是否只读（默认 true 防止意外写入）'),
    }),
    handler: async ({ path, sql, params, readonly }) => {
      try {
        const db = new Database(resolve(path), readonly ? { readonly: true } : {})
        const stmt = db.prepare(sql)
        const rows = params ? stmt.all(...params) : stmt.all()
        db.close()
        const output = JSON.stringify(rows, null, 2)
        return { success: true, output: output || '(空结果集)' }
      } catch (e) {
        return { success: false, error: `数据库查询失败: ${e instanceof Error ? e.message : String(e)}` }
      }
    },
  })

  // ========== 补丁 ==========

  globalToolRegistry.register({
    name: 'apply_patch',
    description: '应用补丁到文件。支持统一 diff 格式（git diff 输出）和结构化 JSON 补丁。',
    inputSchema: z.object({
      filePath: z.string().describe('要修补的文件路径'),
      patch: z.string().describe('补丁内容（unified diff 格式，或 JSON Patch 格式）'),
      reverse: z.boolean().optional().describe('是否反向应用（撤销补丁）'),
    }),
    handler: async ({ filePath, patch, reverse }) => {
      // 安全检查：apply_patch 等同于写文件
      const pathCheck = getSecurityLayer().checkPath(filePath)
      if (!pathCheck.allowed) {
        return { success: false, error: pathCheck.reason ?? '路径被安全策略阻止' }
      }
      try {
        const absPath = resolve(filePath)
        if (!existsSync(absPath)) return { success: false, error: `文件不存在: ${absPath}` }
        const patchFile = join(process.cwd(), '.tmp_patch.tmp')
        await writeFile(patchFile, patch, 'utf-8')
        const args = ['apply', reverse ? '-R' : '', patchFile]
        try {
          const { stdout, stderr } = await execFileAsync('git', args.filter(Boolean), { cwd: dirname(absPath), timeout: 15_000 })
          await unlink(patchFile).catch(() => {})
          return { success: true, output: stdout || stderr || '补丁应用成功' }
        } catch {
          await unlink(patchFile).catch(() => {})
        }
        try {
          const operations = JSON.parse(patch)
          let content = await readFile(absPath, 'utf-8')
          for (const op of operations) {
            if (op.op === 'replace' && op.path && op.value !== undefined) {
              content = content.replace(op.path, op.value)
            }
          }
          await writeFile(absPath, content, 'utf-8')
          return { success: true, output: 'JSON 补丁应用成功' }
        } catch { /* 不是有效的 JSON Patch，继续尝试其他格式 */ }
        return { success: false, error: '补丁格式不支持。请使用 unified diff (git diff 输出) 或 JSON Patch 格式。' }
      } catch (e) {
        return { success: false, error: `补丁应用失败: ${e instanceof Error ? e.message : String(e)}` }
      }
    },
  })

  // ========== Excel 操作 ==========

  globalToolRegistry.register({
    name: 'excel_read',
    description: '读取 Excel 文件内容。支持 .xlsx/.xls/.csv。可指定 sheet 名称和行范围。',
    inputSchema: z.object({
      path: z.string().describe('Excel 文件路径'),
      sheet: z.string().optional().describe('Sheet 名称（默认第一个）'),
      range: z.string().optional().describe('行范围，如 "A1:D10" 或 "1-50"（第1到50行）'),
      format: z.enum(['json', 'csv', 'markdown']).default('markdown').describe('输出格式'),
    }),
    handler: async ({ path, sheet, range, format }) => {
      try {
        const XLSX = await import('xlsx')
        const wb = XLSX.readFile(path)
        const sheetName = sheet || wb.SheetNames[0]
        if (!sheetName) return { success: false, error: '文件中没有 sheet' }
        const ws = wb.Sheets[sheetName]
        let data: any[][]
        if (range) {
          const rangeMatch = range.match(/^(\d+)-(\d+)$/)
          if (rangeMatch) {
            const start = parseInt(rangeMatch[1]) - 1
            const end = parseInt(rangeMatch[2])
            const all = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' })
            data = all.slice(start, end)
          } else {
            data = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '', range })
          }
        } else {
          data = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' })
        }
        if (data.length === 0) return { success: true, output: '(空 sheet)' }
        if (format === 'json') return { success: true, output: JSON.stringify(data, null, 2) }
        if (format === 'csv') {
          const csv = data.map(row => row.map(String).join(',')).join('\n')
          return { success: true, output: csv }
        }
        const header = data[0].map(String)
        const rows = data.slice(1)
        const colWidths = header.map((h, i) => {
          const maxLen = Math.max(h.length, ...rows.map(r => String(r[i] ?? '').length))
          return Math.min(maxLen, 40)
        })
        const pad = (s: string, w: number) => s.slice(0, w).padEnd(w)
        const lines: string[] = []
        lines.push('| ' + header.map((h, i) => pad(h, colWidths[i])).join(' | ') + ' |')
        lines.push('| ' + colWidths.map(w => '-'.repeat(w)).join(' | ') + ' |')
        for (const row of rows) {
          lines.push('| ' + header.map((_, i) => pad(String(row[i] ?? ''), colWidths[i])).join(' | ') + ' |')
        }
        return { success: true, output: lines.join('\n') }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    },
  })

  globalToolRegistry.register({
    name: 'excel_write',
    description: '写入数据到 Excel 文件。支持新建或追加到已有文件。',
    inputSchema: z.object({
      path: z.string().describe('输出文件路径 (.xlsx/.csv)'),
      sheet: z.string().optional().describe('Sheet 名称（默认 Sheet1）'),
      data: z.array(z.array(z.any())).describe('二维数组数据，第一行为表头'),
      append: z.boolean().optional().describe('是否追加到已有文件（默认覆盖）'),
    }),
    handler: async ({ path, sheet, data, append }) => {
      try {
        const XLSX = await import('xlsx')
        let wb: any
        if (append && existsSync(path)) {
          wb = XLSX.readFile(path)
        } else {
          wb = XLSX.utils.book_new()
        }
        const ws = XLSX.utils.aoa_to_sheet(data)
        const sheetName = sheet || 'Sheet1'
        if (wb.SheetNames.includes(sheetName)) {
          const idx = wb.SheetNames.indexOf(sheetName)
          wb.SheetNames[idx] = sheetName
          wb.Sheets[sheetName] = ws
        } else {
          XLSX.utils.book_append_sheet(wb, ws, sheetName)
        }
        XLSX.writeFile(wb, path)
        return { success: true, output: `已写入 ${data.length} 行数据到 ${path}` }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    },
  })

  // ========== 图片 ==========

  globalToolRegistry.register({
    name: 'read_image',
    description: '读取图片文件并返回 base64 数据（供视觉模型分析）。支持 PNG/JPG/GIF/WebP/BMP/SVG。',
    inputSchema: z.object({
      path: z.string().describe('图片文件路径'),
    }),
    handler: async ({ path }) => {
      try {
        const absPath = resolve(path)
        if (!existsSync(absPath)) return { success: false, error: `文件不存在: ${absPath}` }
        const ext = extname(absPath).toLowerCase()
        if (!IMAGE_EXTS.has(ext)) return { success: false, error: `不支持的图片格式: ${ext}。支持: ${[...IMAGE_EXTS].join(', ')}` }
        const buffer = readFileSync(absPath)
        const mime = ext === '.svg' ? 'image/svg+xml' : `image/${ext.slice(1) === 'jpg' ? 'jpeg' : ext.slice(1)}`
        const base64 = buffer.toString('base64')
        return { success: true, output: `[图片已读取: ${absPath} (${(buffer.length / 1024).toFixed(1)} KB, ${mime})]`, imageData: { base64, mimeType: mime } }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    },
  })
  // ========== 其他工具 ==========

  globalToolRegistry.register({
    name: 'todo_write',
    description: '写入/更新 todo 列表。复杂任务（>3步）请先写 todo 追踪进度。',
    inputSchema: z.object({
      items: z.array(z.object({
        id: z.string().describe('唯一标识'),
        content: z.string().describe('任务描述'),
        status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).describe('状态'),
        activeForm: z.string().optional().describe('当前正在做什么'),
      })).describe('todo 列表'),
    }),
    handler: async ({ items }) => {
      // 验证 id 唯一性
      const ids = items.map((i: any) => i.id)
      if (new Set(ids).size !== ids.length) {
        return { success: false, error: '存在重复的 todo id' }
      }
      // 更新全局 todo 状态
      const { setTodos } = await import('../tui/context/todos')
      setTodos(items)
      return { success: true, output: `已更新 ${items.length} 个 todo` }
    },
  })

  globalToolRegistry.register({
    name: 'todo_read',
    description: '读取当前 todo 列表。',
    inputSchema: z.object({}),
    handler: async () => {
      const { todos } = await import('../tui/context/todos')
      const items = todos()
      if (items.length === 0) {
        return { success: true, output: '暂无 todo' }
      }
      const lines = items.map((item: any) => {
        const icon = item.status === 'completed' ? '✅' : item.status === 'in_progress' ? '🔄' : item.status === 'cancelled' ? '❌' : '⬜'
        return `${icon} [${item.id}] ${item.content}${item.activeForm ? ` (${item.activeForm})` : ''}`
      })
      return { success: true, output: lines.join('\n') }
    },
  })
}

/**
 * 从系统剪贴板读取图片（Windows/macOS/Linux）
 * 返回 { data: base64, mime: string } 或 undefined
 */
export async function readClipboardImage(): Promise<{ data: string; mime: string } | undefined> {
  const platform = process.platform

  if (platform === 'win32') {
    const script = `Add-Type -AssemblyName System.Windows.Forms; $img = [System.Windows.Forms.Clipboard]::GetImage(); if ($img) { $ms = New-Object System.IO.MemoryStream; $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); [System.Convert]::ToBase64String($ms.ToArray()) }`
    try {
        const { stdout } = await promisify(exec)(
          `powershell.exe -NonInteractive -NoProfile -command "${script}"`,
          { timeout: 5000, maxBuffer: 10 * 1024 * 1024 }
        )
        const trimmed = stdout.trim()
        if (trimmed && trimmed.length > 0) {
          return { data: trimmed, mime: 'image/png' }
        }
      } catch { /* 剪贴板可能不是图片 */ }
  }

  if (platform === 'darwin') {
    const tmpfile = join(require('os').tmpdir(), 'licode-clipboard.png')
    try {
      await promisify(exec)(
        `osascript -e 'set imageData to the clipboard as "PNGf"' -e 'set fileRef to open for access POSIX file "${tmpfile}" with write permission' -e 'set eof fileRef to 0' -e 'write imageData to fileRef' -e 'close access fileRef'`,
        { timeout: 5000 }
      )
      const buffer = readFileSync(tmpfile)
      return { data: buffer.toString('base64'), mime: 'image/png' }
    } catch { /* macOS 剪贴板无图片 */ } finally {
      try { require('fs').unlinkSync(tmpfile) } catch { /* 临时文件清理 */ }
    }
  }

  if (platform === 'linux') {
    try {
      const { stdout } = await promisify(execFile)('xclip', ['-selection', 'clipboard', '-t', 'image/png', '-o'], { timeout: 5000 })
      if (stdout.length > 0) {
        return { data: Buffer.from(stdout).toString('base64'), mime: 'image/png' }
      }
    } catch { /* xclip 可能未安装或剪贴板无图片 */ }
  }

  return undefined
}

/**
 * 读取图片文件并返回 base64（供 loop.tsx 使用）
 */
export function readImageFile(filePath: string): { base64: string; mimeType: string } | undefined {
  try {
    const absPath = resolve(filePath)
    if (!existsSync(absPath)) return undefined
    const ext = extname(absPath).toLowerCase()
    if (!IMAGE_EXTS.has(ext)) return undefined
    const buffer = readFileSync(absPath)
    const mime = ext === '.svg' ? 'image/svg+xml' : `image/${ext.slice(1) === 'jpg' ? 'jpeg' : ext.slice(1)}`
    return { base64: buffer.toString('base64'), mimeType: mime }
  } catch {
    return undefined
  }
}
