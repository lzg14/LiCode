import { readFile, writeFile, stat } from 'fs/promises'
import { exec } from 'child_process'
import { promisify } from 'util'
import { glob } from 'glob'
import { existsSync } from 'fs'
import type { ToolDefinition } from './types'
import { globalToolRegistry } from './registry'

const execAsync = promisify(exec)

export function registerBuiltinTools(): void {
  // Read tool
  globalToolRegistry.register({
    name: 'read',
    description: 'Read file content',
    inputSchema: { path: 'string' },
    handler: async ({ path }: { path: string }) => {
      try {
        const content = await readFile(path, 'utf-8')
        return { success: true, output: content }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    },
  })

  // Write tool
  globalToolRegistry.register({
    name: 'write',
    description: 'Write content to file',
    inputSchema: { path: 'string', content: 'string' },
    handler: async ({ path, content }: { path: string; content: string }) => {
      try {
        await writeFile(path, content, 'utf-8')
        return { success: true, output: `Written to ${path}` }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    },
  })

  // Edit tool
  globalToolRegistry.register({
    name: 'edit',
    description: 'Edit file by replacing oldString with newString',
    inputSchema: { path: 'string', oldString: 'string', newString: 'string' },
    handler: async ({ path, oldString, newString }: { path: string; oldString: string; newString: string }) => {
      try {
        if (!existsSync(path)) {
          return { success: false, error: `File not found: ${path}` }
        }
        const content = await readFile(path, 'utf-8')
        if (!content.includes(oldString)) {
          return { success: false, error: `oldString not found in ${path}` }
        }
        const newContent = content.replace(oldString, newString)
        await writeFile(path, newContent, 'utf-8')
        return { success: true, output: `Edited ${path}` }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    },
  })

  // Glob tool
  globalToolRegistry.register({
    name: 'glob',
    description: 'Find files matching pattern',
    inputSchema: { pattern: 'string' },
    handler: async ({ pattern }: { pattern: string }) => {
      try {
        const files = await glob(pattern)
        return { success: true, output: files.join('\n') }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    },
  })

  // Grep tool
  globalToolRegistry.register({
    name: 'grep',
    description: 'Search for pattern in files',
    inputSchema: { pattern: 'string', path: 'string', include: 'string' },
    handler: async ({ pattern, path, include }: { pattern: string; path: string; include?: string }) => {
      try {
        const includeFlag = include ? `--include="${include}"` : ''
        const { stdout } = await execAsync(`grep -rn ${includeFlag} "${pattern}" "${path}" || true`)
        return { success: true, output: stdout || 'No matches found' }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    },
  })

  // Stat tool
  globalToolRegistry.register({
    name: 'stat',
    description: 'Get file statistics',
    inputSchema: { path: 'string' },
    handler: async ({ path }: { path: string }) => {
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

  // Bash tool
  globalToolRegistry.register({
    name: 'bash',
    description: 'Execute shell command',
    inputSchema: { command: 'string', cwd: 'string' },
    handler: async ({ command, cwd }: { command: string; cwd?: string }) => {
      try {
        const { stdout, stderr } = await execAsync(command, { cwd, timeout: 30000 })
        return { success: true, output: stdout || stderr || 'Command executed' }
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e)
        return { success: false, error }
      }
    },
  })
}
