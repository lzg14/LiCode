import { LoopContext } from '../loop'
import { planReview } from './plan-review'

export async function plan(ctx: LoopContext): Promise<Partial<LoopContext>> {
  ctx.onStreamText?.('制定计划...\n')

  // 1. 生成计划
  const plan = await generatePlan(ctx)
  ctx.onStreamText?.(`计划: ${plan.steps.join(' → ')}\n`)

  // 2. E3+ 必须审核
  if (ctx.effortLevel >= 3) {
    const reviewResult = await planReview(ctx, plan)

    if (reviewResult.status === 'blocked') {
      ctx.onStreamText?.('计划被阻止，需要修改\n')
      return {
        phase: 'PLAN',
        pendingReview: reviewResult,
      }
    }

    ctx.onStreamText?.('计划审核通过\n')
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

async function generatePlan(_ctx: LoopContext): Promise<{ steps: string[] }> {
  return {
    steps: ['分析需求', '编写代码', '测试验证'],
  }
}
