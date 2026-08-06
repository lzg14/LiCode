/**
 * Prompt 模板加载器
 * 
 * 支持从目录加载 Markdown 格式的 prompt 模板
 * 支持 {{variable}} 变量替换
 */

import { readdir, readFile, access, stat } from 'fs/promises'
import { join, basename } from 'path'
import { homedir } from 'os'
import { devLogger } from '../../core/dev-logger'

/** Prompt 模板 */
export interface PromptTemplate {
  /** 模板名称（文件名去掉扩展名） */
  name: string
  /** 模板内容 */
  content: string
  /** 模板描述（从 frontmatter 或首行提取） */
  description?: string
  /** 模板变量列表 */
  variables: string[]
  /** 文件路径 */
  path: string
}

/** 模板加载选项 */
export interface PromptLoadOptions {
  /** 全局目录 */
  globalDir?: string
  /** 项目目录 */
  projectDir?: string
  /** 额外目录 */
  extraDirs?: string[]
}

/**
 * 从内容中提取变量
 */
function extractVariables(content: string): string[] {
  const regex = /\{\{(\w+)\}\}/g
  const vars = new Set<string>()
  let match
  while ((match = regex.exec(content)) !== null) {
    vars.add(match[1])
  }
  return Array.from(vars)
}

/**
 * 从内容中提取描述（首行或 frontmatter）
 */
function extractDescription(content: string): string | undefined {
  // 尝试从 frontmatter 提取
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
  if (frontmatterMatch) {
    const descMatch = frontmatterMatch[1].match(/description:\s*(.+)/)
    if (descMatch) {
      return descMatch[1].trim()
    }
  }

  // 尝试从首行提取（跳过空行和 # 标题）
  const lines = content.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('#')) {
      return trimmed.replace(/^#+\s*/, '')
    }
    if (trimmed.startsWith('---')) continue
    return trimmed.slice(0, 100)
  }
  return undefined
}

/**
 * 加载单个模板文件
 */
async function loadTemplate(filePath: string): Promise<PromptTemplate | null> {
  try {
    const content = await readFile(filePath, 'utf-8')
    const name = basename(filePath, '.md')
    return {
      name,
      content,
      description: extractDescription(content),
      variables: extractVariables(content),
      path: filePath,
    }
  } catch (e) {
    devLogger.warn('PROMPT', `Failed to load template ${filePath}: ${e}`)
    return null
  }
}

/**
 * 从目录加载所有模板
 */
async function loadFromDir(dir: string): Promise<PromptTemplate[]> {
  try {
    await access(dir)
  } catch {
    return []
  }

  const templates: PromptTemplate[] = []
  try {
    const entries = await readdir(dir)
    for (const entry of entries) {
      if (!entry.endsWith('.md')) continue
      const filePath = join(dir, entry)
      const template = await loadTemplate(filePath)
      if (template) {
        templates.push(template)
      }
    }
  } catch (e) {
    devLogger.warn('PROMPT', `Failed to read directory ${dir}: ${e}`)
  }

  return templates
}

/**
 * 加载所有 prompt 模板
 */
export async function loadAllPrompts(options: PromptLoadOptions = {}): Promise<PromptTemplate[]> {
  const home = homedir()
  const globalDir = options.globalDir ?? join(home, '.licode', 'prompts')
  const projectDir = options.projectDir ?? join(process.cwd(), '.licode', 'prompts')

  const templates: PromptTemplate[] = []

  // 加载全局模板
  const globalTemplates = await loadFromDir(globalDir)
  templates.push(...globalTemplates)

  // 加载项目模板
  const projectTemplates = await loadFromDir(projectDir)
  templates.push(...projectTemplates)

  // 加载额外目录
  if (options.extraDirs) {
    for (const dir of options.extraDirs) {
      const extraTemplates = await loadFromDir(dir)
      templates.push(...extraTemplates)
    }
  }

  // 去重（项目模板优先）
  const seen = new Set<string>()
  const unique: PromptTemplate[] = []
  for (const t of templates) {
    if (!seen.has(t.name)) {
      seen.add(t.name)
      unique.push(t)
    }
  }

  devLogger.info('PROMPT', `Loaded ${unique.length} prompt templates`)
  return unique
}

/**
 * 查找模板
 */
export async function findPrompt(
  name: string,
  options: PromptLoadOptions = {},
): Promise<PromptTemplate | undefined> {
  const templates = await loadAllPrompts(options)
  return templates.find(t => t.name === name)
}

/**
 * 渲染模板（替换变量）
 */
export function renderTemplate(
  template: PromptTemplate | string,
  variables: Record<string, string> = {},
): string {
  const content = typeof template === 'string' ? template : template.content
  
  return content.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (key in variables) {
      return variables[key]
    }
    // 如果变量未提供，保留原始占位符
    return match
  })
}

/**
 * 从 frontmatter 解析元数据
 */
export function parseFrontmatter(content: string): {
  metadata: Record<string, string>
  body: string
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) {
    return { metadata: {}, body: content }
  }

  const metadata: Record<string, string> = {}
  const lines = match[1].split('\n')
  for (const line of lines) {
    const colonIdx = line.indexOf(':')
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim()
      const value = line.slice(colonIdx + 1).trim()
      metadata[key] = value
    }
  }

  return { metadata, body: match[2] }
}
