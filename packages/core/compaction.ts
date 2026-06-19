/**
 * 上下文压缩
 * 当上下文过长时自动压缩，保留关键信息
 */

export interface CompactionConfig {
  maxTokens?: number
  compressionRatio?: number
  preserveRecent?: number
  summaryPrompt?: string
}

export interface CompactionResult {
  summary: string
  tokensSaved: number
  compressedMessages: { content: string }[]
  metadata: {
    originalCount: number
    compressedCount: number
    timestamp: number
  }
}

export class ContextCompactor {
  private config: CompactionConfig

  constructor(config: CompactionConfig = {}) {
    this.config = {
      maxTokens: 8000,
      compressionRatio: 0.3,
      preserveRecent: 5,
      ...config,
    }
  }

  /**
   * 压缩消息列表
   */
  async compact(
    messages: { content: string }[],
    maxTokens?: number
  ): Promise<CompactionResult> {
    const effectiveMaxTokens = maxTokens || this.config.maxTokens!
    
    // 计算当前 token 估算
    const currentTokens = this.estimateTokens(messages)
    
    // 如果未超出限制，无需压缩
    if (currentTokens <= effectiveMaxTokens) {
      return {
        summary: '',
        tokensSaved: 0,
        compressedMessages: messages,
        metadata: {
          originalCount: messages.length,
          compressedCount: messages.length,
          timestamp: Date.now(),
        },
      }
    }

    // 保留最近的消息
    const recentMessages = messages.slice(-this.config.preserveRecent!)
    const oldMessages = messages.slice(0, -this.config.preserveRecent!)

    // 压缩旧消息
    const summary = this.summarizeMessages(oldMessages)
    const compressedTokens = this.estimateTokens([{ content: summary }])

    return {
      summary,
      tokensSaved: currentTokens - compressedTokens,
      compressedMessages: [{ content: summary }, ...recentMessages],
      metadata: {
        originalCount: messages.length,
        compressedCount: 1 + recentMessages.length,
        timestamp: Date.now(),
      },
    }
  }

  /**
   * 估算 token 数量
   */
  private estimateTokens(messages: { content: string }[]): number {
    // 简单估算：1 token ≈ 4 字符（英文）或 1.5 字符（中文）
    let totalChars = 0
    for (const msg of messages) {
      totalChars += msg.content.length
    }
    return Math.ceil(totalChars / 3)
  }

  /**
   * 消息摘要生成
   */
  private summarizeMessages(messages: { content: string }[]): string {
    if (messages.length === 0) return ''

    // 提取关键信息
    const keyPoints: string[] = []
    const topics = new Set<string>()

    for (const msg of messages) {
      const content = msg.content
      // 提取可能的主题（简单的关键词提取）
      const words = content.split(/\s+/).slice(0, 5)
      words.forEach(w => topics.add(w))

      // 如果内容较短，直接包含
      if (content.length < 100) {
        keyPoints.push(content)
      } else {
        // 否则只保留第一句
        const firstSentence = content.split(/[。！？\n]/)[0]
        if (firstSentence) {
          keyPoints.push(firstSentence)
        }
      }
    }

    // 生成摘要
    const summary = [
      `[上下文压缩 - 共 ${messages.length} 条消息]`,
      '',
      ...keyPoints.slice(0, 5),
      '',
      `涉及主题: ${Array.from(topics).slice(0, 10).join(', ')}`,
    ].join('\n')

    return summary
  }

  /**
   * 检查是否需要压缩
   */
  shouldCompact(messages: { content: string }[]): boolean {
    const tokens = this.estimateTokens(messages)
    return tokens > this.config.maxTokens!
  }

  /**
   * 获取压缩建议
   */
  getCompactionAdvice(messages: { content: string }[]): {
    needsCompaction: boolean
    currentTokens: number
    maxTokens: number
    suggestion: string
  } {
    const currentTokens = this.estimateTokens(messages)
    const needsCompaction = currentTokens > this.config.maxTokens!

    let suggestion = ''
    if (needsCompaction) {
      const ratio = this.config.maxTokens! / currentTokens
      suggestion = `建议压缩 ${Math.ceil((1 - ratio) * 100)}% 的内容，保留最近 ${this.config.preserveRecent} 条消息`
    }

    return {
      needsCompaction,
      currentTokens,
      maxTokens: this.config.maxTokens!,
      suggestion,
    }
  }
}
