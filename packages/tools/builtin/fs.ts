import { existsSync, readFileSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import type { ToolRegistry } from '../registry'
import type { ToolContext } from '../context'

function registerRead(registry: ToolRegistry): void {
  registry.register({
    name: 'read',
    description: '读取文件内容。支持指定行号范围。',
    inputSchema: z.object({
      path: z.string().describe('文件路径'),
      offset: z.number().optional().describe('起始行号（从1开始）'),
      limit: z.number().optional().describe('读取行数'),
    }),
    handler: async ({ path, offset, limit }: { path: string; offset?: number; limit?: number }) => {
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
}

function registerWrite(registry: ToolRegistry): void {
  registry.register({
    name: 'write',
    description: '写入内容到文件。如果文件不存在会自动创建。',
    inputSchema: z.object({
      path: z.string().describe('文件路径'),
      content: z.string().describe('要写入的内容'),
    }),
    handler: async ({ path, content }: { path: string; content: string }) => {
      try {
        let oldContent = ''
        try {
          if (existsSync(path)) {
            oldContent = await readFile(path, 'utf-8')
          }
        } catch { /* 文件不存在时说明是新建，无需读旧内容 */ }

        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, content, 'utf-8')

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
}

function registerEdit(registry: ToolRegistry): void {
  registry.register({
    name: 'edit',
    description: '编辑文件：将 oldString 替换为 newString。支持 replaceAll 替换所有匹配。',
    inputSchema: z.object({
      path: z.string().describe('文件路径'),
      oldString: z.string().describe('要替换的文本'),
      newString: z.string().describe('替换后的文本'),
      replaceAll: z.boolean().optional().describe('是否替换所有匹配'),
    }),
    handler: async ({ path, oldString, newString, replaceAll }: { path: string; oldString: string; newString: string; replaceAll?: boolean }) => {
      try {
        if (!existsSync(path)) return { success: false, error: `文件不存在: ${path}` }
        const content = await readFile(path, 'utf-8')
        if (!content.includes(oldString)) return { success: false, error: `在 ${path} 中未找到 oldString` }
        const newContent = replaceAll ? content.split(oldString).join(newString) : content.replace(oldString, newString)
        await writeFile(path, newContent, 'utf-8')

        const oldLines = content.split('\n')
        const newLines = newContent.split('\n')
        const diff: string[] = [`--- a/${path}`, `+++ b/${path}`]
        let oldLineNum = 1
        let newLineNum = 1

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
}

function registerListDir(registry: ToolRegistry): void {
  registry.register({
    name: 'list_directory',
    description: '列出目录内容。',
    inputSchema: z.object({
      path: z.string().describe('目录路径'),
      recursive: z.boolean().optional().describe('是否递归'),
    }),
    handler: async ({ path, recursive }: { path: string; recursive?: boolean }) => {
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
}

function registerCreateDir(registry: ToolRegistry): void {
  registry.register({
    name: 'create_directory',
    description: '创建目录（递归创建）。',
    inputSchema: z.object({ path: z.string().describe('目录路径') }),
    handler: async ({ path }: { path: string }) => {
      try { await mkdir(path, { recursive: true }); return { success: true, output: `已创建 ${path}` } }
      catch (e) { return { success: false, error: String(e) } }
    },
  })
}

function registerDeleteFile(registry: ToolRegistry): void {
  registry.register({
    name: 'delete_file',
    description: '删除文件。',
    inputSchema: z.object({ path: z.string().describe('文件路径') }),
    handler: async ({ path }: { path: string }) => {
      try { await unlink(path); return { success: true, output: `已删除 ${path}` } }
      catch (e) { return { success: false, error: String(e) } }
    },
  })
}

function registerMoveFile(registry: ToolRegistry): void {
  registry.register({
    name: 'move_file',
    description: '移动或重命名文件。',
    inputSchema: z.object({ source: z.string(), destination: z.string() }),
    handler: async ({ source, destination }: { source: string; destination: string }) => {
      try { await rename(source, destination); return { success: true, output: `${source} → ${destination}` } }
      catch (e) { return { success: false, error: String(e) } }
    },
  })
}

function registerCopyFile(registry: ToolRegistry): void {
  registry.register({
    name: 'copy_file',
    description: '复制文件。',
    inputSchema: z.object({ source: z.string(), destination: z.string() }),
    handler: async ({ source, destination }: { source: string; destination: string }) => {
      try { await copyFile(source, destination); return { success: true, output: `${source} → ${destination}` } }
      catch (e) { return { success: false, error: String(e) } }
    },
  })
}

export function registerFSTools(registry: ToolRegistry): void {
  registerRead(registry)
  registerWrite(registry)
  registerEdit(registry)
  registerListDir(registry)
  registerCreateDir(registry)
  registerDeleteFile(registry)
  registerMoveFile(registry)
  registerCopyFile(registry)
}
