export interface ReviewResult {
  status: 'approved' | 'blocked' | 'converged'
  approved: boolean
  issues: string[]
  pendingIssues?: string[]
  message?: string
}

const REVIEW_DIMENSIONS = [
  { name: '完整性', check: (steps: string[]) => steps.length < 2 ? '步骤太少，无法覆盖需求' : null },
  { name: '可执行性', check: (steps: string[]) => steps.some(s => s.length < 5) ? '存在过短的无效步骤' : null },
  { name: '安全性', check: (steps: string[]) => steps.some(s => /delete|rm|drop|format/i.test(s) && !/备份|确认|check/i.test(s)) ? '包含破坏性操作但缺少安全确认步骤' : null },
  { name: '验证', check: (steps: string[]) => !steps.some(s => /test|验证|检查|verify/i.test(s)) ? '缺少验证步骤' : null },
]

export async function planReview(ctx: any, plan: { steps: string[] }): Promise<ReviewResult> {
  let iteration = 0
  let previousIssues: string[] = []

  while (iteration < 3) {
    const result = await triggerReview(ctx, plan, iteration)

    if (result.approved) {
      return {
        status: 'approved',
        approved: true,
        issues: [],
      }
    }

    if (isConverged(result.issues, previousIssues)) {
      return {
        status: 'converged',
        approved: false,
        issues: result.issues,
        pendingIssues: previousIssues,
      }
    }

    previousIssues = result.issues
    iteration++
  }

  return {
    status: 'blocked',
    approved: false,
    issues: previousIssues,
    message: '请人工决策',
  }
}

async function triggerReview(ctx: any, plan: { steps: string[] }, iteration: number): Promise<{ approved: boolean; issues: string[] }> {
  // 1. 先做本地规则检查（离线，无 API 调用）
  const localIssues: string[] = []
  for (const dim of REVIEW_DIMENSIONS) {
    const issue = dim.check(plan.steps)
    if (issue) localIssues.push(`[${dim.name}] ${issue}`)
  }

  // 2. 如果有 LLM，再做 LLM 评审
  if (ctx?.llm && plan.steps.length > 0) {
    try {
      const prompt = `你是一个代码方案评审专家。请评审以下执行计划：

${plan.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}

${iteration > 0 ? `上一轮评审指出的问题（已修复的忽略）：
${ctx.reviewResult?.issues?.join('\n') ?? '无'}
请重点检查本轮修改是否解决了问题。` : ''}

评审维度：
1. **完整性**：是否遗漏了关键步骤？（如备份、测试、文档）
2. **可执行性**：步骤是否具体？有无歧义？
3. **安全性**：是否有风险操作？需要前置确认吗？
4. **效率**：有没有更优的路径？

只返回 JSON 格式：
{ "approved": true/false, "issues": ["问题1", "问题2"] }
approved 为 true 表示无需修改，false 表示需要修改。issues 列出问题点，最多 3 条。`

      const response = await ctx.llm.complete({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
      })

      const text = response.content.trim()
      const jsonMatch = text.match(/\{[\s\S]*?\}/)
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0])
        const issues = [...localIssues, ...(result.issues || [])]
        return { approved: issues.length === 0, issues }
      }
    } catch {
      // LLM 失败，只用本地规则
    }
  }

  // 3. 本地评审结论
  return { approved: localIssues.length === 0, issues: localIssues }
}

function isConverged(current: string[], previous: string[]): boolean {
  if (previous.length === 0) return false
  const similarity = calculateSimilarity(current, previous)
  return similarity >= 0.8
}

function calculateSimilarity(a: string[], b: string[]): number {
  if (a.length !== b.length) return 0
  const matches = a.filter((item, index) => item === b[index]).length
  return matches / a.length
}
