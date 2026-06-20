import { LoopContext } from '../loop'
import { planReview } from './plan-review'

export async function plan(ctx: LoopContext): Promise<Partial<LoopContext>> {
  const plan = await generatePlan(ctx)

  // 2. E3+ 必须审核
  if (ctx.effortLevel >= 3) {
    const reviewResult = await planReview(ctx, plan)

    if (reviewResult.status === 'blocked') {
      return {
        phase: 'PLAN',
        pendingReview: reviewResult,
      }
    }

    return {
      phase: 'BUILD',
      plan,
      reviewResult,
    }
  }

  // E1/E2 直接执行
  return {
    phase: 'BUILD',
    plan,
  }
}

async function generatePlan(ctx: LoopContext): Promise<{ steps: string[] }> {
  if (!ctx.llm) {
    return { steps: ['分析需求', '编写代码', '测试验证'] }
  }

  try {
    const prompt = `你是一个项目规划助手。根据用户需求生成简明的执行计划。

用户需求：${ctx.userInput}
${ctx.sensitiveWarning ? `安全警告：${ctx.sensitiveWarning}` : ''}

请用 JSON 数组格式返回步骤列表，例如：["步骤1", "步骤2", "步骤3"]。
步骤要具体、可执行，不超过 5 步。只返回 JSON，不要其他内容。`

    const response = await ctx.llm.complete({
      model: ctx.model?.modelId,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
    })

    const text = response.content.trim()
    const jsonMatch = text.match(/\[[\s\S]*?\]/)
    if (jsonMatch) {
      const steps = JSON.parse(jsonMatch[0])
      if (Array.isArray(steps) && steps.length > 0) {
        return { steps: steps.map(String) }
      }
    }
  } catch (e) {
    ctx.onPhaseLog?.(`计划生成失败: ${e}\n`)
  }

  return { steps: ['分析需求', '编写代码', '测试验证'] }
}
