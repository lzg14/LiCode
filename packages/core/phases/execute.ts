import { LoopContext } from '../loop'

const SYSTEM_PROMPT = `你是一个名为 licode 的 AI 助手，专注于代码开发。
你的核心理念是"宁可慢，不要白干"——宁可多问清楚，也不要假设。
请用中文回答用户的问题，保持简洁明了。`

export async function execute(ctx: LoopContext): Promise<Partial<LoopContext>> {
  ctx.onStreamText?.('正在生成回复...\n')

  if (!ctx.llm) {
    const msg = '请配置 LLM provider'
    ctx.onStreamText?.(msg)
    return {
      phase: 'VERIFY',
      aiResponse: msg,
      deliverable: ctx.intermediateResults,
    }
  }

  try {
    const response = await ctx.llm.complete({
      model: 'claude-sonnet-4-20250514',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: ctx.userInput },
      ],
      temperature: 0.7,
    })

    ctx.onStreamText?.(response.content)

    return {
      phase: 'VERIFY',
      aiResponse: response.content,
      deliverable: ctx.intermediateResults,
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    const msg = `抱歉，AI 调用失败: ${error}`
    ctx.onStreamText?.(`[LLM Error] ${error}\n`)
    return {
      phase: 'VERIFY',
      aiResponse: msg,
      deliverable: ctx.intermediateResults,
    }
  }
}
