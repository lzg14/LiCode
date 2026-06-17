export async function verify(ctx) {
    if (ctx.effortLevel >= 3) {
        const reviewResult = await triggerReviewAgent(ctx.deliverable);
        return {
            phase: reviewResult.approved ? 'LEARN' : 'PLAN',
            reviewResult,
        };
    }
    return {
        phase: 'LEARN',
    };
}
async function triggerReviewAgent(deliverable) {
    return { approved: true, issues: [], status: 'approved' };
}
