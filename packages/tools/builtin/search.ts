import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { glob as globLib } from 'glob'
import { z } from 'zod'
import type { ToolRegistry } from '../registry'

const execFileAsync = promisify(execFile)

function registerGlob(registry: ToolRegistry): void {
  registry.register({
    name: 'glob',
    description: '按模式搜索文件（支持 **/*.ts 等通配符）。',
    inputSchema: z.object({ pattern: z.string(), path: z.string().optional() }),
    handler: async ({ pattern, path }: { pattern: string; path?: string }) => {
      try {
        const files = await globLib(pattern, { cwd: path ?? process.cwd(), ignore: ['node_modules', '.git', 'dist'] })
        return { success: true, output: files.join('\n') || '未找到匹配文件' }
      } catch (e) { return { success: false, error: String(e) } }
    },
  })
}

function registerGrep(registry: ToolRegistry): void {
  registry.register({
    name: 'grep',
    description: '在文件中搜索内容（正则，跨平台）。优先使用 ripgrep (rg)，自动 fallback 到系统 grep。',
    inputSchema: z.object({ pattern: z.string(), path: z.string(), include: z.string().optional() }),
    handler: async ({ pattern, path, include }: { pattern: string; path: string; include?: string }) => {
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
      if (stdout === null) {
        const winPath = cwd.replace(/\//g, '\\')
        stdout = await tryExec('findstr', ['/s', '/n', '/r', pattern, `${winPath}\\*`])
      }
      return { success: true, output: (stdout || '').trim() || '未找到匹配' }
    },
  })
}

function registerCodesearch(registry: ToolRegistry): void {
  registry.register({
    name: 'codesearch',
    description: '搜索代码。优先 ripgrep，自动 fallback 到 grep/findstr。',
    inputSchema: z.object({ pattern: z.string(), path: z.string().optional(), include: z.string().optional(), maxResults: z.number().default(30) }),
    handler: async ({ pattern, path, include, maxResults }: { pattern: string; path?: string; include?: string; maxResults: number }) => {
      const cwd = path ?? process.cwd()
      try {
        const args = ['-n', '--max-count', String(maxResults)]
        if (include) args.push('-g', include)
        args.push(pattern, cwd)
        const { stdout } = await execFileAsync('rg', args, { maxBuffer: 1024 * 1024 })
        const lines = (stdout || '').split('\n').filter(Boolean).slice(0, maxResults)
        return { success: true, output: lines.join('\n') || '未找到匹配' }
      } catch {}
      try {
        if (process.platform === 'win32') {
          const winPath = cwd.replace(/\//g, '\\')
          const { stdout } = await execFileAsync('findstr', ['/S', '/N', pattern, `${winPath}\\*`], { maxBuffer: 1024 * 1024 })
          const lines = (stdout || '').split('\n').filter(Boolean).slice(0, maxResults)
          return { success: true, output: lines.join('\n') || '未找到匹配' }
        } else {
          const grepArgs = ['-rn', '--max-count', String(maxResults)]
          if (include) grepArgs.push('--include', include)
          grepArgs.push(pattern, cwd)
          const { stdout } = await execFileAsync('grep', grepArgs, { maxBuffer: 1024 * 1024 })
          const lines = (stdout || '').split('\n').filter(Boolean).slice(0, maxResults)
          return { success: true, output: lines.join('\n') || '未找到匹配' }
        }
      } catch (e) { return { success: false, error: String(e) } }
    },
  })
}

export function registerSearchTools(registry: ToolRegistry): void {
  registerGlob(registry)
  registerGrep(registry)
  registerCodesearch(registry)
}
