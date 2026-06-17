import { LoopContext } from '../loop'

export async function learn(ctx: LoopContext): Promise<Partial<LoopContext>> {
  await updateMemory(ctx)
  await summarizeExperience(ctx)

  return {
    phase: 'DONE' as any,
  }
}

async function updateMemory(ctx: LoopContext): Promise<void> {
  // 写入记忆
}

async function summarizeExperience(ctx: LoopContext): Promise<void> {
  // 总结经验
}