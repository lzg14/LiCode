import { LoopContext } from '../loop'

export async function build(ctx: LoopContext): Promise<Partial<LoopContext>> {
  ctx.onPhaseLog?.('构建方案...')

  // 如果没有 LLM，跳过
  if (!ctx.llm) {
    return { phase: 'EXECUTE' }
  }

  // 让 LLM 先生成方案骨架，不要直接执行
  try {
    const response = await ctx.llm.complete({
      model: ctx.model?.modelId,
      messages: [{
        role: 'user',
        content: `你是一个代码架构师。请为以下需求设计技术方案。

需求：${ctx.userInput}
${ctx.risks?.length ? `已知风险：${ctx.risks.join('、')}` : ''}
${ctx.plan?.steps?.length ? `计划步骤：${ctx.plan.steps.join(' → ')}` : ''}

请输出技术方案，包含：
1. 要修改/创建的文件列表
2. 每个文件的核心改动
3. 改动之间的依赖顺序
4. 需要特别注意的边界情况

以 JSON 格式返回：{ "files": ["文件路径", ...], "dependencies": ["依赖说明", ...], "boundaries": ["边界情况", ...] }`,
      }],
      temperature: 0.3,
    })

    const text = response.content.trim()
    const jsonMatch = text.match(/\{[\s\S]*?\}/)
    if (jsonMatch) {
      const design = JSON.parse(jsonMatch[0])
      ctx.onPhaseLog?.(`方案涉及 ${design.files?.length ?? 0} 个文件`)
      if (design.boundaries?.length) {
        ctx.onPhaseLog?.(`边界情况: ${design.boundaries.join(', ')}`)
      }
    }
  } catch {
    // 方案生成失败不阻塞，直接进 EXECUTE
    ctx.onPhaseLog?.('方案生成跳过，直接执行')
  }

  return {
    phase: 'EXECUTE',
  }
}
