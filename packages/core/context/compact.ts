export interface CompactionResult {
  summary: string
  tokensSaved: number
}

export async function compactContext(
  messages: { content: string }[],
  maxTokens: number
): Promise<CompactionResult> {
  // 简单的压缩逻辑：生成摘要
  return {
    summary: `[Compacted summary of ${messages.length} messages]`,
    tokensSaved: messages.length * 50,
  }
}
