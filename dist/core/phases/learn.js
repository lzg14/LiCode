export async function learn(ctx) {
    await updateMemory(ctx);
    await summarizeExperience(ctx);
    return {
        phase: 'DONE',
    };
}
async function updateMemory(ctx) {
    // 写入记忆
}
async function summarizeExperience(ctx) {
    // 总结经验
}
