import { LoopContext } from '../loop'

export async function learn(ctx: LoopContext): Promise<Partial<LoopContext>> {
  ctx.onPhaseLog?.('总结学习...')

  // 1. 保存记忆（原有的）
  if (ctx.memory && ctx.userInput && ctx.aiResponse) {
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

  // 2. 记录验证结果（如果有）
  if (ctx.reviewResult) {
    if (ctx.reviewResult.approved) {
      ctx.onPhaseLog?.('方案验证通过 ✓')
    } else {
      ctx.onPhaseLog?.(`方案待改进: ${ctx.reviewResult.issues.join('; ')}`)
      // 存到记忆供后续参考
      if (ctx.memory) {
        try {
          await ctx.memory.store({
            scope: 'session',
            type: 'lesson',
            content: `失败原因: ${ctx.reviewResult.issues.join('; ')}\n用户需求: ${ctx.userInput}\n建议: 需要修正后重试`,
          })
        } catch {}
      }
    }
  }

  // 3. 记录工具使用统计（如果有 deliverable）
  if (ctx.deliverable?.length) {
    ctx.onPhaseLog?.(`生成了 ${ctx.deliverable.length} 个交付物`)
  }

  return {
    phase: 'DONE',
  }
}
