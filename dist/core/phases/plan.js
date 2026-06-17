import { planReview } from './plan-review';
export async function plan(ctx) {
    // 1. 生成计划
    const plan = await generatePlan(ctx);
    // 2. E3+ 必须审核
    if (ctx.effortLevel >= 3) {
        const reviewResult = await planReview(ctx, plan);
        if (reviewResult.status === 'blocked') {
            return {
                phase: 'PLAN',
                pendingReview: reviewResult,
            };
        }
        return {
            phase: 'BUILD',
            plan,
            reviewResult,
        };
    }
    // E1/E2 直接执行
    return {
        phase: 'BUILD',
        plan,
    };
}
async function generatePlan(ctx) {
    return {
        steps: ['分析需求', '编写代码', '测试验证'],
    };
}
