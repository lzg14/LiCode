import { LoopContext } from '../loop'

export async function execute(ctx: LoopContext): Promise<Partial<LoopContext>> {
  return {
    phase: 'VERIFY',
    deliverable: ctx.intermediateResults,
  }
}