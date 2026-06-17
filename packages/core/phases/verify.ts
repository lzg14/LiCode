import { LoopContext } from '../loop'
import type { ReviewResult } from './plan-review'

export async function verify(ctx: LoopContext): Promise<Partial<LoopContext>> {
  if (ctx.effortLevel >= 3) {
    const reviewResult = await triggerReviewAgent(ctx.deliverable)
    return {
      phase: reviewResult.approved ? 'LEARN' : 'PLAN',
      reviewResult,
    }
  }

  return {
    phase: 'LEARN',
  }
}

async function triggerReviewAgent(deliverable: unknown): Promise<ReviewResult> {
  return { approved: true, issues: [], status: 'approved' }
}