import { existsSync, readFileSync } from 'fs'
import { globSync } from 'glob'
import { execSync } from 'child_process'
import { join } from 'path'
import type { Deliverable } from './types'

export interface VerifyResult {
  passed: boolean
  message?: string
  detail?: string
}

export async function verifyDeliverables(
  deliverables: Deliverable[],
  cwd: string = process.cwd()
): Promise<VerifyResult[]> {
  const results: VerifyResult[] = []

  for (const d of deliverables) {
    try {
      const result = await checkDeliverable(d, cwd)
      results.push(result)
    } catch (err) {
      results.push({
        passed: false,
        message: `检查时出错: ${err instanceof Error ? err.message : String(err)}`
      })
    }
  }

  return results
}

async function checkDeliverable(d: Deliverable, cwd: string): Promise<VerifyResult> {
  switch (d.check) {
    case 'file_exists':
      return checkFileExists(d.path!, cwd)
    case 'contains_pattern':
      return checkContainsPattern(d.path!, d.value!, cwd)
    case 'has_export':
      return checkHasExport(d.path!, d.value!, cwd)
    case 'has_no_import':
      return checkHasNoImport(d.path!, d.value!, cwd)
    case 'has_no_error':
      return checkHasNoError(d.path!, cwd)
    case 'glob_match':
      return checkGlobMatch(d.glob!, cwd)
    default:
      return { passed: false, message: `未知的 check 类型: ${(d as any).check}` }
  }
}

function checkFileExists(path: string, cwd: string): VerifyResult {
  const fullPath = isAbsolute(path) ? path : join(cwd, path)
  const exists = existsSync(fullPath)
  return {
    passed: exists,
    message: exists ? undefined : `文件不存在: ${path}`
  }
}

function checkContainsPattern(path: string, pattern: string, cwd: string): VerifyResult {
  const fullPath = isAbsolute(path) ? path : join(cwd, path)
  if (!existsSync(fullPath)) {
    return { passed: false, message: `文件不存在: ${path}` }
  }
  const content = readFileSync(fullPath, 'utf-8')
  const regex = new RegExp(pattern)
  const found = regex.test(content)
  return {
    passed: found,
    message: found ? undefined : `文件 ${path} 中未找到模式: ${pattern}`
  }
}

function checkHasExport(path: string, exportName: string, cwd: string): VerifyResult {
  const fullPath = isAbsolute(path) ? path : join(cwd, path)
  if (!existsSync(fullPath)) {
    return { passed: false, message: `文件不存在: ${path}` }
  }
  const content = readFileSync(fullPath, 'utf-8')
  const patterns = [
    new RegExp(`export\\s+(?:function|const|class)\\s+${exportName}`),
    new RegExp(`export\\s+\\{[^}]*\\b${exportName}\\b[^}]*\\}`),
    new RegExp(`module\\.exports\\s*=\\s*{[^}]*\\b${exportName}\\b[^}]*}`),
  ]
  const found = patterns.some(p => p.test(content))
  return {
    passed: found,
    message: found ? undefined : `文件 ${path} 中未找到 export: ${exportName}`
  }
}

function checkHasNoImport(path: string, importName: string, cwd: string): VerifyResult {
  const fullPath = isAbsolute(path) ? path : join(cwd, path)
  if (!existsSync(fullPath)) {
    return { passed: false, message: `文件不存在: ${path}` }
  }
  const content = readFileSync(fullPath, 'utf-8')
  // 匹配 import ... importName（不要求分号结尾）
  const regex = new RegExp(`import\\s+[^\\n]*\\b${importName}\\b`)
  const found = regex.test(content)
  return {
    passed: !found,
    message: !found ? undefined : `文件 ${path} 中仍存在 import: ${importName}`
  }
}

function checkHasNoError(path: string, cwd: string): VerifyResult {
  const fullPath = isAbsolute(path) ? path : join(cwd, path)
  if (!existsSync(fullPath)) {
    return { passed: false, message: `文件不存在: ${path}` }
  }
  try {
    execSync(`npx tsc --noEmit --skipLibCheck "${fullPath}"`, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30000,
    })
    return { passed: true }
  } catch (err: any) {
    return {
      passed: false,
      message: `TypeScript 编译错误: ${path}`,
      detail: err.stdout?.toString() || err.message
    }
  }
}

function checkGlobMatch(globPattern: string, cwd: string): VerifyResult {
  const files = globSync(globPattern, { cwd })
  return {
    passed: files.length > 0,
    message: files.length > 0 ? undefined : `Glob 模式 ${globPattern} 未匹配到任何文件`
  }
}

function isAbsolute(p: string): boolean {
  return p.startsWith('/') || /^[a-zA-Z]:/.test(p)
}
