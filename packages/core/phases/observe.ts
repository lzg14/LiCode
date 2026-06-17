import { LoopContext } from '../loop'
import { existsSync, execSync } from 'child_process'
import { join } from 'path'
import { checkSensitivePath } from '../security/sensitive'

export async function observe(ctx: LoopContext): Promise<Partial<LoopContext>> {
  // 1. 解析用户输入
  // 2. 判断 Effort Level
  const effortLevel = estimateEffortLevel(ctx.userInput)

  // 3. Git 自动初始化（内置，不需要用户确认）
  await ensureGitInitialized(ctx.cwd)

  // 4. 敏感目录检查
  const sensitiveWarning = checkSensitivePath(ctx.cwd)

  return {
    effortLevel,
    phase: 'THINK',
    sensitiveWarning,
  }
}

async function ensureGitInitialized(cwd: string): Promise<void> {
  const gitDir = join(cwd, '.git')
  if (!existsSync(gitDir)) {
    try {
      execSync('git init', { cwd, stdio: 'pipe' })
      execSync('git add -A && git commit -m "Initial commit by licode"', { cwd, stdio: 'pipe' })
    } catch {
      // 失败只记录警告，不阻止流程
    }
  }
}

function estimateEffortLevel(input: string): number {
  if (input.length < 50) return 1
  if (input.includes('?')) return 2
  if (input.includes('帮我') || input.includes('帮我搞')) return 3
  if (input.includes('重新设计') || input.includes('架构')) return 5
  return 4
}