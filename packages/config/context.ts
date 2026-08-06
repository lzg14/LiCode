/**
 * 上下文文件加载器
 * 
 * 支持从多级目录加载上下文文件（AGENTS.md、.licode.md 等）
 * 参考 pi 的 AGENTS.md 加载机制
 */

import { readFile, access, stat } from 'fs/promises'
import { join, dirname, resolve } from 'path'
import { homedir } from 'os'
import { devLogger } from '../core/dev-logger'

/** 上下文文件配置 */
export interface ContextConfig {
  /** 是否启用上下文文件加载 */
  enabled?: boolean
  /** 自定义文件名列表 */
  fileNames?: string[]
  /** 是否向上遍历父目录 */
  traverseUp?: boolean
  /** 最大向上遍历层级 */
  maxDepth?: number
}

/** 加载的上下文文件 */
export interface ContextFile {
  /** 文件路径 */
  path: string
  /** 文件内容 */
  content: string
  /** 相对层级（0=当前目录，1=父目录，...） */
  depth: number
  /** 是否为追加模式（APPEND_ 前缀） */
  append: boolean
}

const DEFAULT_FILE_NAMES = [
  '.licode.md',
  'AGENTS.md',
  'CLAUDE.md',
  'APPEND_SYSTEM.md',
]

/**
 * 读取文件内容
 */
async function read_file_safe(path: string): Promise<string | null> {
  try {
    await access(path)
    return await readFile(path, 'utf-8')
  } catch {
    return null
  }
}

/**
 * 从指定目录向上遍历查找上下文文件
 */
export async function loadContextFiles(
  startDir: string,
  config: ContextConfig = {},
): Promise<ContextFile[]> {
  const {
    enabled = true,
    fileNames = DEFAULT_FILE_NAMES,
    traverseUp = true,
    maxDepth = 10,
  } = config

  if (!enabled) return []

  const files: ContextFile[] = []
  const seen = new Set<string>() // 去重（避免重复加载同一文件）

  // 定义要搜索的目录
  const dirsToSearch: string[] = [startDir]
  
  if (traverseUp) {
    let current = dirname(startDir)
    const home = homedir()
    
    for (let depth = 1; depth <= maxDepth; depth++) {
      // 停止条件：到达用户主目录或根目录
      if (current === home || current === dirname(current)) break
      dirsToSearch.push(current)
      current = dirname(current)
    }
  }

  // 搜索全局目录
  const globalDir = join(homedir(), '.licode')
  dirsToSearch.push(globalDir)

  // 加载文件
  for (let depth = 0; depth < dirsToSearch.length; depth++) {
    const dir = dirsToSearch[depth]
    
    for (const fileName of fileNames) {
      const filePath = join(dir, fileName)
      
      // 跳过已加载的文件
      if (seen.has(filePath)) continue
      seen.add(filePath)

      const content = await read_file_safe(filePath)
      if (content !== null) {
        files.push({
          path: filePath,
          content,
          depth,
          append: fileName.startsWith('APPEND_'),
        })
        devLogger.debug('CONTEXT', `Loaded context file: ${filePath}`)
      }
    }
  }

  // 按深度排序（浅层优先）
  files.sort((a, b) => a.depth - b.depth)

  // 分离追加文件和普通文件
  const normalFiles = files.filter(f => !f.append)
  const appendFiles = files.filter(f => f.append)

  // 追加文件总是追加到末尾
  return [...normalFiles, ...appendFiles]
}

/**
 * 合并上下文文件内容
 */
export function mergeContextContent(files: ContextFile[]): string {
  const parts: string[] = []

  for (const file of files) {
    if (file.append) {
      // 追加模式：直接追加内容
      parts.push(file.content)
    } else {
      // 普通模式：添加文件标记
      parts.push(`<!-- Source: ${file.path} -->\n${file.content}`)
    }
  }

  return parts.join('\n\n---\n\n')
}

/**
 * 检查是否存在上下文文件
 */
export async function hasContextFiles(
  dir: string,
  fileNames: string[] = DEFAULT_FILE_NAMES,
): Promise<boolean> {
  for (const fileName of fileNames) {
    const filePath = join(dir, fileName)
    try {
      await access(filePath)
      return true
    } catch {
      continue
    }
  }
  return false
}

/**
 * 获取上下文文件列表（用于显示）
 */
export async function listContextFiles(
  dir: string,
  fileNames: string[] = DEFAULT_FILE_NAMES,
): Promise<Array<{ path: string; exists: boolean }>> {
  const results: Array<{ path: string; exists: boolean }> = []
  
  for (const fileName of fileNames) {
    const filePath = join(dir, fileName)
    try {
      await access(filePath)
      results.push({ path: filePath, exists: true })
    } catch {
      results.push({ path: filePath, exists: false })
    }
  }
  
  return results
}

/**
 * 创建 AGENTS.md 兼容的上下文文件（如果不存在）
 */
export async function createDefaultAgentsFile(dir: string): Promise<boolean> {
  const filePath = join(dir, 'AGENTS.md')
  
  try {
    await access(filePath)
    // 文件已存在
    return false
  } catch {
    // 文件不存在，创建默认内容
    const content = `# AGENTS.md

## Project Context

This file provides context for AI coding assistants (licode, Claude Code, etc.).

## Guidelines

- Write clean, maintainable code
- Follow existing code style and conventions
- Add tests for new functionality
- Update documentation as needed

## Common Commands

\`\`\`bash
# Build
bun run build

# Test
bun test

# Lint
bun run lint
\`\`\`
`
    
    try {
      const { writeFile } = await import('fs/promises')
      await writeFile(filePath, content, 'utf-8')
      devLogger.info('CONTEXT', `Created default AGENTS.md: ${filePath}`)
      return true
    } catch (e) {
      devLogger.warn('CONTEXT', `Failed to create AGENTS.md: ${e}`)
      return false
    }
  }
}
