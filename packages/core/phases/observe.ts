import { LoopContext } from '../loop'
import { checkSensitivePath } from '../../security/sensitive'

export async function observe(ctx: LoopContext): Promise<Partial<LoopContext>> {
  // 1. 判断 Effort Level
  const effortLevel = estimateEffortLevel(ctx.userInput)

  // 2. 敏感目录检查
  const sw = checkSensitivePath(ctx.cwd)
  const sensitiveWarning = sw ? `${sw.reason} (${sw.path})` : undefined

  // 3. 流式输出观察结果
  ctx.onStreamText?.(`观察完成: Effort Level ${effortLevel}\n`)

  return {
    effortLevel,
    phase: 'THINK',
    sensitiveWarning,
  }
}

function estimateEffortLevel(input: string): number {
  if (input.length < 50) return 1
  if (input.includes('?')) return 2
  if (input.includes('帮我') || input.includes('帮我搞')) return 3
  if (input.includes('重新设计') || input.includes('架构')) return 5
  return 4
}