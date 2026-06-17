import { LoopContext } from '../loop'

export async function build(ctx: LoopContext): Promise<Partial<LoopContext>> {
  return {
    phase: 'EXECUTE',
    intermediateResults: [],
  }
}