import { LoopContext } from '../loop'
import { checkSensitivePath } from '../../security/sensitive'
import { existsSync } from 'fs'
import { join } from 'path'

const gitInitCache = new Map<string, number>()
const CACHE_TTL = 60_000

export async function observe(ctx: LoopContext): Promise<Partial<LoopContext>> {
  const effortLevel = estimateEffortLevel(ctx.userInput)
  const sw = checkSensitivePath(ctx.cwd)
  const sensitiveWarning = sw ? `${sw.reason} (${sw.path})` : undefined
  ensureGitCached(ctx.cwd)

  return {
    effortLevel,
    phase: 'THINK',
    sensitiveWarning,
  }
}

function ensureGitCached(cwd: string): void {
  const cached = gitInitCache.get(cwd)
  if (cached !== undefined && Date.now() - cached < CACHE_TTL) return

  const gitDir = join(cwd, '.git')
  if (existsSync(gitDir)) {
    gitInitCache.set(cwd, Date.now())
  } else {
    gitInitCache.delete(cwd)
  }
}

function estimateEffortLevel(input: string): number {
  const len = input.length
  const hasCode = /[`{}\[\]();]/.test(input) || /file|src|lib|test|packages?\//i.test(input)
  const hasMultiStep = /然后|接着|同时|另外|以及|之后|并且/.test(input)
  const hasQuestion = /\?|？|怎么|如何|为什么|什么|哪里/.test(input)
  const hasAction = /帮我|实现|添加|修改|删除|重构|修复|优化|创建|编写/.test(input)
  const hasDesign = /设计|架构|重构|规划|方案/.test(input)
  const hasFileRef = /\.\w{1,5}\b/.test(input)

  if (len < 30 && !hasMultiStep && !hasDesign) return 1
  if (len < 80 && hasQuestion && !hasAction) return 2
  if (len < 200 && hasAction && !hasMultiStep) return 3
  if (hasMultiStep || (hasAction && hasCode) || (hasAction && hasFileRef)) return 4
  if (hasDesign || len > 500) return 5
  return 3
}
