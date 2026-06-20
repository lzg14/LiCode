import { LoopContext } from '../loop'
import { generateInterviewQuestions, generateAntiCriteria, needsInterview } from '../interview'

export async function think(ctx: LoopContext): Promise<Partial<LoopContext>> {
  let risks: string[] = []
  if (ctx.llm) {
    try {
      const response = await ctx.llm.complete({
        model: 'claude-sonnet-4-20250514',
        messages: [
          {
            role: 'user',
            content: `分析以下需求的潜在风险、假设和失败模式。返回 JSON 数组格式的风险列表：\n\n${ctx.userInput}`,
          },
        ],
        temperature: 0.3,
      })
      const parsed = JSON.parse(response.content)
      if (!Array.isArray(parsed)) {
        throw new Error('返回结果不是数组')
      }
      risks = parsed.filter((item): item is string => typeof item === 'string')
    } catch {
      risks = analyzeRisks(ctx.userInput)
    }
  } else {
    risks = analyzeRisks(ctx.userInput)
  }

  const interviewQuestions = needsInterview(ctx)
    ? generateInterviewQuestions(ctx)
    : []

  if (interviewQuestions.length > 0) {
    return {
      phase: 'THINK',
      risks,
      pendingQuestions: interviewQuestions.map(q => q.question),
    }
  }

  const antiCriteria = generateAntiCriteria(ctx)
  if (antiCriteria.length > 0) {
    return {
      phase: 'THINK',
      risks,
      antiCriteria,
    }
  }

  return {
    phase: 'PLAN',
    risks,
  }
}

function analyzeRisks(input: string): string[] {
  const risks: string[] = []
  if (input.includes('缓存')) risks.push('缓存一致性问题')
  if (input.includes('日志')) risks.push('可能记录敏感信息')
  if (input.includes('删除')) risks.push('数据不可恢复')
  if (input.includes('依赖')) risks.push('供应链风险')
  if (input.includes('系统') || input.includes('架构')) risks.push('架构变更影响范围大')
  return risks
}
