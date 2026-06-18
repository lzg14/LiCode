import { LoopContext } from '../loop'
import { generateInterviewQuestions, generateAntiCriteria, needsInterview } from '../interview'

export async function think(ctx: LoopContext): Promise<Partial<LoopContext>> {
  // 1. 使用 LLM 分析风险/假设/失败模式
  let risks: string[] = []
  if (ctx.llm) {
    try {
      ctx.onStreamText?.('正在分析风险...\n')
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
      risks = JSON.parse(response.content)
      ctx.onStreamText?.(`发现 ${risks.length} 个风险点\n`)
    } catch {
      // LLM 调用失败时使用本地分析
      risks = analyzeRisks(ctx.userInput)
    }
  } else {
    risks = analyzeRisks(ctx.userInput)
  }

  // 2. 生成 Interview 追问问题
  const interviewQuestions = needsInterview(ctx)
    ? generateInterviewQuestions(ctx)
    : []

  if (interviewQuestions.length > 0) {
    ctx.onStreamText?.(`需要追问 ${interviewQuestions.length} 个问题\n`)
    return {
      phase: 'THINK',
      risks,
      pendingQuestions: interviewQuestions.map(q => q.question),
    }
  }

  // 3. 生成 Anti-criteria 反向追问
  const antiCriteria = generateAntiCriteria(ctx)
  if (antiCriteria.length > 0) {
    ctx.onStreamText?.(`识别到 ${antiCriteria.length} 个潜在弊端\n`)
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
