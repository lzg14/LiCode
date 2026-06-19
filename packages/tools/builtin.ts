import { readFile, writeFile, stat } from 'fs/promises'
import { exec } from 'child_process'
import { promisify } from 'util'
import { glob } from 'glob'
import { existsSync } from 'fs'
import { z } from 'zod'
import type { ToolDefinition } from './types'
import { globalToolRegistry } from './registry'

const execAsync = promisify(exec)

export function registerBuiltinTools(): void {
  globalToolRegistry.register({
    name: 'read',
    description: 'Read file content',
    inputSchema: z.object({ path: z.string(), offset: z.number().optional(), limit: z.number().optional() }),
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
    description: 'Write content to file',
    inputSchema: z.object({ path: z.string(), content: z.string() }),
    handler: async ({ path, content }) => {
      try {
        await writeFile(path, content, 'utf-8')
        return { success: true, output: `Written to ${path}` }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    },
  })

  globalToolRegistry.register({
    name: 'edit',
    description: 'Edit file by replacing oldString with newString',
    inputSchema: z.object({ path: z.string(), oldString: z.string(), newString: z.string(), replaceAll: z.boolean().optional() }),
    handler: async ({ path, oldString, newString, replaceAll }) => {
      try {
        if (!existsSync(path)) {
          return { success: false, error: `File not found: ${path}` }
        }
        const content = await readFile(path, 'utf-8')
        if (!content.includes(oldString)) {
          return { success: false, error: `oldString not found in ${path}` }
        }
        const newContent = replaceAll
          ? content.split(oldString).join(newString)
          : content.replace(oldString, newString)
        await writeFile(path, newContent, 'utf-8')
        return { success: true, output: `Edited ${path}` }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    },
  })

  globalToolRegistry.register({
    name: 'glob',
    description: 'Find files matching pattern',
    inputSchema: z.object({ pattern: z.string(), path: z.string().optional() }),
    handler: async ({ pattern, path }) => {
      try {
        const cwd = path ?? process.cwd()
        const files = await glob(pattern, { cwd })
        return { success: true, output: files.join('\n') }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    },
  })

  globalToolRegistry.register({
    name: 'grep',
    description: 'Search for pattern in files',
    inputSchema: z.object({ pattern: z.string(), path: z.string(), include: z.string().optional() }),
    handler: async ({ pattern, path, include }) => {
      try {
        const includeFlag = include ? `--include="${include}"` : ''
        const { stdout } = await execAsync(`grep -rn ${includeFlag} "${pattern}" "${path}" || true`)
        return { success: true, output: stdout || 'No matches found' }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    },
  })

  globalToolRegistry.register({
    name: 'stat',
    description: 'Get file statistics',
    inputSchema: z.object({ path: z.string() }),
    handler: async ({ path }) => {
      try {
        const info = await stat(path)
        return {
          success: true,
          output: JSON.stringify({
            size: info.size,
            mtime: info.mtime.toISOString(),
            isFile: info.isFile(),
            isDirectory: info.isDirectory(),
          }),
        }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    },
  })

  globalToolRegistry.register({
    name: 'bash',
    description: 'Execute shell command',
    inputSchema: z.object({
      command: z.string(),
      cwd: z.string().optional(),
      timeout: z.number().optional(),
    }),
    handler: async ({ command, cwd, timeout }, ctx) => {
      try {
        const { stdout, stderr } = await execAsync(command, {
          cwd: cwd ?? ctx.cwd,
          timeout: timeout ?? ctx.timeout ?? 30_000,
        })
        return { success: true, output: stdout || stderr || 'Command executed' }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    },
  })

  globalToolRegistry.register({
    name: 'webfetch',
    description: 'Fetch content from a URL and return markdown',
    inputSchema: z.object({
      url: z.string().url(),
      format: z.enum(['markdown', 'text', 'html']).default('markdown'),
      timeout: z.number().optional(),
    }),
    handler: async ({ url, format, timeout }) => {
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeout ?? 15_000)

        const response = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'Licode/0.1.0' },
        })
        clearTimeout(timer)

        if (!response.ok) {
          return { success: false, error: `HTTP ${response.status}: ${response.statusText}` }
        }

        const body = await response.text()
        const contentType = response.headers.get('content-type') ?? ''

        if (format === 'html' || contentType.includes('text/html')) {
          const cleaned = body
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
          return { success: true, output: cleaned }
        }

        return { success: true, output: body }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    },
  })

  globalToolRegistry.register({
    name: 'websearch',
    description: 'Search the web using a search engine',
    inputSchema: z.object({
      query: z.string(),
      numResults: z.number().min(1).max(20).default(5),
    }),
    handler: async ({ query, numResults }) => {
      try {
        const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
        const response = await fetch(searchUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Licode/0.1.0)' },
        })
        if (!response.ok) {
          return { success: false, error: `Search failed: HTTP ${response.status}` }
        }
        const html = await response.text()
        const results: string[] = []
        const regex = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
        let match
        while ((match = regex.exec(html)) !== null && results.length < numResults) {
          const title = match[2].replace(/<[^>]+>/g, '').trim()
          const href = decodeURIComponent(match[1].replace(/.*uddg=/, '').replace(/&.*/, ''))
          results.push(`[${title}](${href})`)
        }
        return {
          success: true,
          output: results.length > 0
            ? results.join('\n')
            : 'No results found',
        }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    },
  })

  globalToolRegistry.register({
    name: 'codesearch',
    description: 'Search for code patterns in a codebase using ripgrep',
    inputSchema: z.object({
      pattern: z.string(),
      path: z.string().optional(),
      include: z.string().optional(),
      maxResults: z.number().default(30),
    }),
    handler: async ({ pattern, path, include, maxResults }) => {
      try {
        const searchPath = path ?? process.cwd()
        const includeFlag = include ? `-g "${include}"` : ''
        const cmd = `rg -n ${includeFlag} --max-count=${maxResults} "${pattern}" "${searchPath}" 2>/dev/null || true`
        const { stdout } = await execAsync(cmd, { maxBuffer: 1024 * 1024 })
        const lines = (stdout || '').split('\n').filter(Boolean).slice(0, maxResults)
        return {
          success: true,
          output: lines.length > 0 ? lines.join('\n') : 'No matches found',
        }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    },
  })
}
