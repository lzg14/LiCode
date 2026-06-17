export async function planReview(ctx, plan) {
    let iteration = 0;
    let previousIssues = [];
    while (iteration < 3) {
        const result = await triggerReview(plan);
        if (result.approved) {
            return {
                status: 'approved',
                approved: true,
                issues: [],
            };
        }
        // 收敛判断：80% 相似度
        if (isConverged(result.issues, previousIssues)) {
            return {
                status: 'converged',
                approved: false,
                issues: result.issues,
                pendingIssues: previousIssues,
            };
        }
        previousIssues = result.issues;
        iteration++;
    }
    // 3 次后仍未通过
    return {
        status: 'blocked',
        approved: false,
        issues: previousIssues,
        message: '请人工决策',
    };
}
async function triggerReview(plan) {
    // 模拟审核
    return { approved: true, issues: [] };
}
function isConverged(current, previous) {
    if (previous.length === 0)
        return false;
    const similarity = calculateSimilarity(current, previous);
    return similarity >= 0.8;
}
function calculateSimilarity(a, b) {
    if (a.length !== b.length)
        return 0;
    const matches = a.filter((item, index) => item === b[index]).length;
    return matches / a.length;
}
