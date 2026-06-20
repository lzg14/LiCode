import type { LoopContext } from './loop'

/**
 * Review Agent - 自动触发反方视角评审
 * 在执行前发现方案漏洞
 */

interface ReviewDimension {
  name: string
  questions: string[]
}

const REVIEW_DIMENSIONS: ReviewDimension[] = [
  {
    name: '逻辑漏洞',
    questions: [
      '假设是否成立？',
      '因果关系是否成立？',
      '边界条件是否考虑？',
    ],
  },
  {
    name: '边界情况',
    questions: [
      '空输入时会怎样？',
      '极限输入时会怎样？',
      '错误输入时会怎样？',
    ],
  },
  {
    name: '替代方案',
    questions: [
      '有更好的实现方式吗？',
      '有没有现成的库/工具？',
      '是否可以简化？',
    ],
  },
  {
    name: '失败模式',
    questions: [
      '哪里会出错？',
      '失败了怎么恢复？',
      '需要重试吗？',
    ],
  },
  {
    name: '成本效益',
    questions: [
      '投入产出比合理吗？',
      '有没有更快的路径？',
      '是否值得做？',
    ],
  },
]

export interface ReviewResult {
  approved: boolean
  dimensions: {
    name: string
    findings: string[]
    passed: boolean
  }[]
  summary: string
  recommendation: 'approve' | 'revise' | 'reject'
}

/**
 * 执行评审
 */
export async function reviewPlan(ctx: LoopContext): Promise<ReviewResult> {
  const { llm, userInput, plan, risks = [] } = ctx

  // 如果没有 LLM，使用本地评审
  if (!llm) {
    return localReview(ctx)
  }

  // 构建评审提示词
  const reviewPrompt = buildReviewPrompt(ctx)

  try {
    const response = await llm.complete({
      messages: [
        { role: 'system', content: reviewPrompt },
        { role: 'user', content: `请评审以下方案：\n\n用户需求：${userInput}\n计划：${plan?.steps?.join(' → ') || '未指定'}\n风险：${risks.join('、') || '未识别'}` },
      ],
      temperature: 0.3,
    })

    // 解析评审结果
    return parseReviewResponse(response.content)
  } catch {
    return localReview(ctx)
  }
}

/**
 * 本地评审（无 LLM 时使用）
 */
function localReview(ctx: LoopContext): ReviewResult {
  const { userInput, plan, risks = [], effortLevel } = ctx
  const findings: string[] = []

  // 检查逻辑漏洞
  if (userInput.length < 10) {
    findings.push('需求描述过于简短，可能遗漏关键信息')
  }

  // 检查边界情况
  if (plan?.steps && plan.steps.length === 0) {
    findings.push('计划为空，需要制定具体步骤')
  }

  // 检查风险
  if (risks.length === 0 && effortLevel >= 3) {
    findings.push('未识别到风险，可能遗漏了潜在问题')
  }

  // 检查替代方案
  if (effortLevel >= 4) {
    findings.push('建议搜索是否有现成实现')
  }

  return {
    approved: findings.length === 0,
    dimensions: [
      {
        name: '本地评审',
        findings,
        passed: findings.length === 0,
      },
    ],
    summary: findings.length === 0 ? '本地评审通过' : `发现 ${findings.length} 个问题`,
    recommendation: findings.length === 0 ? 'approve' : 'revise',
  }
}

/**
 * 构建评审提示词
 */
function buildReviewPrompt(ctx: LoopContext): string {
  return `你是 licode 的评审 Agent，负责以反方视角评审方案。

## 评审维度
${REVIEW_DIMENSIONS.map(d => `### ${d.name}\n${d.questions.map(q => `- ${q}`).join('\n')}`).join('\n\n')}

## 评审原则
1. 找出方案中的漏洞和风险
2. 提出改进建议
3. 评估投入产出比
4. 识别失败模式

## 输出格式
请按以下格式输出评审结果：

【评审结论】通过 / 需修改 / 不通过

【逻辑漏洞】
- 发现1
- 发现2

【边界情况】
- 发现1

【替代方案】
- 建议1

【失败模式】
- 风险1

【综合建议】
建议采纳 / 建议修改后采纳 / 建议重新设计`
}

/**
 * 解析评审响应
 */
function parseReviewResponse(response: string): ReviewResult {
  const dimensions: ReviewResult['dimensions'] = []

  // 解析各维度
  for (const dim of REVIEW_DIMENSIONS) {
    const regex = new RegExp(`【${dim.name}】([\\s\\S]*?)(?=【|$)`, 'g')
    const match = regex.exec(response)
    if (match) {
      const findings = match[1]
        .split('\n')
        .filter(line => line.trim().startsWith('-'))
        .map(line => line.replace(/^-\s*/, '').trim())
      dimensions.push({
        name: dim.name,
        findings,
        passed: findings.length === 0,
      })
    }
  }

  // 解析结论
  const conclusionMatch = /【评审结论】(通过|需修改|不通过)/.exec(response)
  const conclusion = conclusionMatch?.[1] || '需修改'

  // 解析建议
  const suggestionMatch = /【综合建议】([\s\S]*?)(?=【|$)/.exec(response)
  const suggestion = suggestionMatch?.[1]?.trim() || ''

  return {
    approved: conclusion === '通过',
    dimensions,
    summary: suggestion || conclusion,
    recommendation: conclusion === '通过' ? 'approve' : conclusion === '不通过' ? 'reject' : 'revise',
  }
}
