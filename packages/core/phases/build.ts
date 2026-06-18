import { LoopContext } from '../loop'
import { globalToolRegistry } from '../../tools/registry'

export async function build(ctx: LoopContext): Promise<Partial<LoopContext>> {
  const results: unknown[] = []

  // 如果有 LLM，让它决定调用哪些工具
  if (ctx.llm && ctx.plan?.steps) {
    for (const step of ctx.plan.steps) {
      // 简化：直接执行预定义的工具调用
      // 实际应该让 LLM 决定调用什么工具
      ctx.onStreamText?.(`执行: ${step}\n`)
    }
  }

  // 执行内置工具示例
  const tools = globalToolRegistry.list()
  if (tools.length > 0) {
    ctx.onStreamText?.(`可用工具: ${tools.map(t => t.name).join(', ')}\n`)
  }

  return {
    phase: 'EXECUTE',
    intermediateResults: results,
  }
}
