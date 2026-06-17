export async function compactContext(messages, maxTokens) {
    // 简单的压缩逻辑：生成摘要
    const summary = messages
        .map(m => m.content)
        .join('\n')
        .slice(0, maxTokens);
    return {
        summary: `[Compacted summary of ${messages.length} messages]`,
        tokensSaved: messages.length * 50,
    };
}
