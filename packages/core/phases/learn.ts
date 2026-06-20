import { LoopContext } from '../loop'

export async function learn(ctx: LoopContext): Promise<Partial<LoopContext>> {
  await updateMemory(ctx)

  return {
    phase: 'DONE',
  }
}

async function updateMemory(ctx: LoopContext): Promise<void> {
  if (!ctx.memory || !ctx.userInput || !ctx.aiResponse) return

  try {
    await ctx.memory.store({
      scope: 'session',
      type: 'memory',
      content: `User: ${ctx.userInput}\nAI: ${ctx.aiResponse}`,
    })
  } catch (e) {
    ctx.onPhaseLog?.(`记忆存储失败: ${e}\n`)
  }
}
