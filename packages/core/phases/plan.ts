import { LoopContext } from '../loop'
import { planReview } from './plan-review'

export async function plan(ctx: LoopContext): Promise<Partial<LoopContext>> {
  const plan = await generatePlan(ctx)

  // E3+ 必须审核
  if (ctx.effortLevel >= 3) {
    const reviewResult = await planReview(ctx, plan)

    if (reviewResult.status === 'blocked') {
      return {
        phase: 'PLAN',
        pendingReview: reviewResult,
      }
    }

    return {
      phase: 'BUILD',
      plan,
      reviewResult,
    }
  }

  // E1/E2 直接执行
  return {
    phase: 'BUILD',
    plan,
  }
}

interface PlanStep {
  action: string
  target: string
  description: string
  check?: string  // 验证条件
}

async function generatePlan(ctx: LoopContext): Promise<{ steps: string[] }> {
  // 无 LLM 时返回默认步骤
  if (!ctx.llm) {
    const steps = buildDefaultSteps(ctx)
    return { steps }
  }

  try {
    const prompt = `你是一个项目规划助手。根据用户需求生成可执行的步骤列表。

用户需求：${ctx.userInput}
${ctx.risks?.length ? `已知风险：${ctx.risks.join('、')}` : ''}
${ctx.sensitiveWarning ? `安全警告：${ctx.sensitiveWarning}` : ''}

要求：
1. 步骤具体、可执行，每个步骤对应一个工具调用
2. 步骤按执行顺序排列
3. 每个步骤标注需要验证的条件
4. 不超过 6 步

以 JSON 数组格式返回，每个元素包含 action/target/description/check：
[
  {"action": "read", "target": "xxx.ts", "description": "读取现有代码", "check": "文件存在"},
  {"action": "edit", "target": "xxx.ts", "description": "修改逻辑", "check": "编译通过"}
]

只返回 JSON，不要解释。`

    const response = await ctx.llm.complete({
      model: ctx.model?.modelId,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
    })

    const text = response.content.trim()
    const jsonMatch = text.match(/\[[\s\S]*?\]/)
    if (jsonMatch) {
      const steps: PlanStep[] = JSON.parse(jsonMatch[0])
      if (Array.isArray(steps) && steps.length > 0) {
        return {
          steps: steps.map(s => `${s.action} ${s.target}: ${s.description}`),
        }
      }
    }
  } catch (e) {
    ctx.onPhaseLog?.(`计划生成失败: ${e}\n`)
  }

  const steps = buildDefaultSteps(ctx)
  return { steps }
}

function buildDefaultSteps(ctx: LoopContext): string[] {
  const steps: string[] = []
  const hasFile = /file|\.\w{1,5}\b/i.test(ctx.userInput)

  if (hasFile) {
    steps.push('读取相关文件了解现状')
    steps.push('分析需求并制定修改方案')
    steps.push('执行代码修改')
    steps.push('验证修改结果')
  } else {
    steps.push('分析需求')
    steps.push('搜索相关信息')
    steps.push('执行操作')
  }

  if (ctx.effortLevel >= 4) {
    steps.push('运行测试验证')
  }

  return steps
}
