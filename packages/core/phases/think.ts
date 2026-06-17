import { LoopContext } from '../loop'

export async function think(ctx: LoopContext): Promise<Partial<LoopContext>> {
  // 1. 分析风险/假设/失败模式
  const risks = analyzeRisks(ctx.userInput)

  // 2. E3+ 触发 grill-me 追问
  if (ctx.effortLevel >= 3) {
    const questions = generateGrillMeQuestions(ctx.userInput, risks)
    if (questions.length > 0) {
      return {
        phase: 'THINK',
        pendingQuestions: questions,
      }
    }
  }

  // 3. E4+ 触发 Anti-criteria
  if (ctx.effortLevel >= 4) {
    const antiCriteria = generateAntiCriteria(ctx.userInput, risks)
    return {
      phase: 'THINK',
      antiCriteria,
    }
  }

  return {
    phase: 'PLAN',
    risks,
  }
}

function analyzeRisks(input: string): string[] {
  // 简单的风险分析
  const risks: string[] = []
  if (input.includes('缓存')) risks.push('缓存一致性问题')
  if (input.includes('日志')) risks.push('可能记录敏感信息')
  if (input.includes('删除')) risks.push('数据不可恢复')
  return risks
}

function generateGrillMeQuestions(input: string, risks: string[]): string[] {
  // E3+ 需要追问
  if (risks.length > 0) {
    return [`你提到的这个需求，有什么特别的风险考量吗？`]
  }
  return []
}

function generateAntiCriteria(input: string, risks: string[]): string[] {
  // E4+ 需要展示弊端
  return [
    '性能影响：这个改动会增加多少复杂度？',
    '维护成本：后续维护难度会增加吗？',
    '耦合风险：会引入新的依赖吗？',
  ]
}