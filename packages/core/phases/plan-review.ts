export interface ReviewResult {
  status: 'approved' | 'blocked' | 'converged'
  approved: boolean
  issues: string[]
  pendingIssues?: string[]
  message?: string
}

export async function planReview(ctx: any, plan: { steps: string[] }): Promise<ReviewResult> {
  let iteration = 0
  let previousIssues: string[] = []

  while (iteration < 3) {
    const result = await triggerReview(plan)

    if (result.approved) {
      return {
        status: 'approved',
        approved: true,
        issues: [],
      }
    }

    // 收敛判断：80% 相似度
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

  // 3 次后仍未通过
  return {
    status: 'blocked',
    approved: false,
    issues: previousIssues,
    message: '请人工决策',
  }
}

async function triggerReview(plan: { steps: string[] }): Promise<{ approved: boolean; issues: string[] }> {
  // 模拟审核
  return { approved: true, issues: [] }
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