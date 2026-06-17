export async function think(ctx) {
    // 1. 使用 LLM 分析风险/假设/失败模式
    let risks = [];
    if (ctx.llm) {
        try {
            const response = await ctx.llm.complete({
                model: 'claude-sonnet-4-20250514',
                messages: [
                    {
                        role: 'user',
                        content: `分析以下需求的潜在风险、假设和失败模式。返回 JSON 数组格式的风险列表：\n\n${ctx.userInput}`,
                    },
                ],
                temperature: 0.3,
            });
            risks = JSON.parse(response.content);
        }
        catch {
            // LLM 调用失败时使用本地分析
            risks = analyzeRisks(ctx.userInput);
        }
    }
    else {
        risks = analyzeRisks(ctx.userInput);
    }
    // 2. E3+ 触发 grill-me 追问
    if (ctx.effortLevel >= 3) {
        const questions = generateGrillMeQuestions(ctx.userInput, risks);
        if (questions.length > 0) {
            return {
                phase: 'THINK',
                pendingQuestions: questions,
            };
        }
    }
    // 3. E4+ 触发 Anti-criteria
    if (ctx.effortLevel >= 4) {
        const antiCriteria = generateAntiCriteria(ctx.userInput, risks);
        return {
            phase: 'THINK',
            antiCriteria,
        };
    }
    return {
        phase: 'PLAN',
        risks,
    };
}
function analyzeRisks(input) {
    // 简单的风险分析
    const risks = [];
    if (input.includes('缓存'))
        risks.push('缓存一致性问题');
    if (input.includes('日志'))
        risks.push('可能记录敏感信息');
    if (input.includes('删除'))
        risks.push('数据不可恢复');
    return risks;
}
function generateGrillMeQuestions(input, risks) {
    // E3+ 需要追问
    if (risks.length > 0) {
        return [`你提到的这个需求，有什么特别的风险考量吗？`];
    }
    return [];
}
function generateAntiCriteria(input, risks) {
    // E4+ 需要展示弊端
    return [
        '性能影响：这个改动会增加多少复杂度？',
        '维护成本：后续维护难度会增加吗？',
        '耦合风险：会引入新的依赖吗？',
    ];
}
