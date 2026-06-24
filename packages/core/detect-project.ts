import { existsSync, readFileSync } from 'fs'
import { join, dirname } from 'path'

export interface ProjectInfo {
  language: string          // 'typescript' | 'python' | 'go' | 'rust' | 'java' | 'csharp' | 'unknown'
  framework?: string        // 'react' | 'vue' | 'svelte' | 'express' | 'fastify' | 'next' | 'nest' | 'bun' | 'deno' | ...
  runtimes: string[]        // ['node', 'bun', 'deno'] 等
  hasLicode: boolean        // 是否有 LICODE.md / .licode.md
  customRole?: string        // LICODE.md 中自定义的角色描述
}

/**
 * 检测项目类型和角色
 * 优先级：LICODE.md > 关键文件扫描
 */
export function detectProject(cwd: string): ProjectInfo {
  // 1. 先找 LICODE.md（用户自定义配置）
  const licodePaths = [
    join(cwd, 'LICODE.md'),
    join(cwd, '.licode.md'),
    join(cwd, '.licode', 'LICODE.md'),
  ]
  let customRole: string | undefined
  let hasLicode = false
  for (const p of licodePaths) {
    if (existsSync(p)) {
      hasLicode = true
      const content = readFileSync(p, 'utf-8')
      // 从 LICODE.md 中提取 role 描述（格式：## role: xxx）
      const roleMatch = content.match(/^##\s*role:\s*(.+)$/m)
      if (roleMatch) {
        customRole = roleMatch[1].trim()
      }
      break
    }
  }

  // 2. 扫描关键文件判断技术栈
  const language = detectLanguage(cwd)
  const runtimes = detectRuntimes(cwd)
  const framework = detectFramework(cwd)

  return { language, framework, runtimes, hasLicode, customRole }
}

function detectLanguage(cwd: string): ProjectInfo['language'] {
  if (existsSync(join(cwd, 'tsconfig.json'))) return 'typescript'
  if (existsSync(join(cwd, 'pyproject.toml')) || existsSync(join(cwd, 'setup.py')) || existsSync(join(cwd, 'requirements.txt'))) return 'python'
  if (existsSync(join(cwd, 'go.mod'))) return 'go'
  if (existsSync(join(cwd, 'Cargo.toml'))) return 'rust'
  if (existsSync(join(cwd, 'pom.xml')) || existsSync(join(cwd, 'build.gradle'))) return 'java'
  if (existsSync(join(cwd, '*.csproj')) || existsSync(join(cwd, '*.sln'))) return 'csharp'
  if (existsSync(join(cwd, 'package.json'))) return 'javascript'
  return 'unknown'
}

function detectRuntimes(cwd: string): string[] {
  const runtimes: string[] = []
  const pkgPath = join(cwd, 'package.json')
  if (!existsSync(pkgPath)) return runtimes
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    if (deps.bun) runtimes.push('bun')
    else if (deps.deno) runtimes.push('deno')
    else if (deps.node) runtimes.push('node')
  } catch {}
  return runtimes
}

function detectFramework(cwd: string): string | undefined {
  const pkgPath = join(cwd, 'package.json')
  if (!existsSync(pkgPath)) return undefined
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    if (deps['@nestjs/core']) return 'nest'
    if (deps['next']) return 'next'
    if (deps.express) return 'express'
    if (deps.fastify) return 'fastify'
    if (deps.react) return 'react'
    if (deps.vue) return 'vue'
    if (deps.svelte) return 'svelte'
    if (deps.bun) return 'bun'
    return undefined
  } catch {
    return undefined
  }
}

/**
 * 根据项目信息生成角色描述
 */
export function buildProjectRole(info: ProjectInfo): string {
  if (info.customRole) {
    return `你是一个资深开发者。${info.customRole}`
  }

  const lang = info.language
  const fw = info.framework

  // TypeScript 项目
  if (lang === 'typescript' || lang === 'javascript') {
    const runtime = info.runtimes[0] ?? 'node'
    if (fw) {
      return `你是一个资深 TypeScript 开发，精通 ${fw} 框架和 ${runtime} 运行时。`
    }
    return `你是一个资深 TypeScript 开发，精通 ${runtime} 运行时。`
  }

  // Python 项目
  if (lang === 'python') {
    return `你是一个资深 Python 开发。`
  }

  // Go 项目
  if (lang === 'go') {
    return `你是一个资深 Go 开发。`
  }

  // Rust 项目
  if (lang === 'rust') {
    return `你是一个资深 Rust 开发。`
  }

  // Java 项目
  if (lang === 'java') {
    return `你是一个资深 Java 开发。`
  }

  return '你是一个资深开发者。'
}
