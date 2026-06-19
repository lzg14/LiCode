import { LoopContext } from '../loop'
import { reviewPlan } from '../review'

export async function verify(ctx: LoopContext): Promise<Partial<LoopContext>> {
  ctx.onStreamText?.('验证质量...\n')

  // E3+ 启动 Review Agent
  if (ctx.effortLevel >= 3) {
    ctx.onStreamText?.('启动 Review Agent 评审...\n')
    const reviewResult = await reviewPlan(ctx)

    if (reviewResult.approved) {
      ctx.onStreamText?.('评审通过 ✓\n')
    } else {
      ctx.onStreamText?.(`评审发现问题: ${reviewResult.summary}\n`)
      for (const dim of reviewResult.dimensions) {
        if (!dim.passed) {
          ctx.onStreamText?.(`  ${dim.name}: ${dim.findings.join(', ')}\n`)
        }
      }
    }

    return {
      phase: reviewResult.approved ? 'LEARN' : 'PLAN',
      reviewResult: {
        approved: reviewResult.approved,
        issues: reviewResult.dimensions.flatMap(d => d.findings),
        status: reviewResult.recommendation,
      },
    }
  }

  ctx.onStreamText?.('验证完成\n')
  return {
    phase: 'LEARN',
  }
}
