import { LoopContext } from '../loop'
import { checkSensitivePath } from '../../security/sensitive'
import { existsSync } from 'fs'
import { join } from 'path'

// 缓存已初始化的目录，避免重复检查
const gitInitCache = new Set<string>()

export async function observe(ctx: LoopContext): Promise<Partial<LoopContext>> {
  // 1. 判断 Effort Level
  const effortLevel = estimateEffortLevel(ctx.userInput)

  // 2. 敏感目录检查
  const sw = checkSensitivePath(ctx.cwd)
  const sensitiveWarning = sw ? `${sw.reason} (${sw.path})` : undefined

  // 3. 检查 git 初始化（只检查一次，缓存结果）
  ensureGitCached(ctx.cwd)

  return {
    effortLevel,
    phase: 'THINK',
    sensitiveWarning,
  }
}

function ensureGitCached(cwd: string): void {
  if (gitInitCache.has(cwd)) return

  const gitDir = join(cwd, '.git')
  if (existsSync(gitDir)) {
    gitInitCache.add(cwd)
  }
  // 如果没有 .git，不自动初始化（避免意外）
}

function estimateEffortLevel(input: string): number {
  if (input.length < 50) return 1
  if (input.includes('?')) return 2
  if (input.includes('帮我') || input.includes('帮我搞')) return 3
  if (input.includes('重新设计') || input.includes('架构')) return 5
  return 4
}