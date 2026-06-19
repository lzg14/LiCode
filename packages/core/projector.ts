/**
 * 消息投影器
 * 将工具结果和内部状态投影为用户可读格式
 */

export interface ProjectedMessage {
  type: 'text' | 'tool-call' | 'tool-result' | 'error' | 'phase-change'
  content: string
  timestamp: number
  metadata?: Record<string, unknown>
}

export interface ProjectorConfig {
  maxLength?: number
  includeTimestamp?: boolean
  compactToolResults?: boolean
}

export class Projector {
  private config: ProjectorConfig

  constructor(config: ProjectorConfig = {}) {
    this.config = {
      maxLength: 1000,
      includeTimestamp: false,
      compactToolResults: true,
      ...config,
    }
  }

  /**
   * 投影 LoopContext 为用户可读格式
   */
  project(ctx: {
    aiResponse?: string
    phase?: string
    streamBuffer?: string
    intermediateResults?: unknown[]
  }): string {
    const parts: string[] = []

    // 投影 AI 回复
    if (ctx.aiResponse) {
      parts.push(this.projectText(ctx.aiResponse))
    }

    // 投影中间结果
    if (ctx.intermediateResults?.length) {
      const projected = this.projectToolResults(ctx.intermediateResults)
      if (projected) {
        parts.push(projected)
      }
    }

    return parts.join('\n\n')
  }

  /**
   * 投影文本内容
   */
  projectText(text: string): string {
    if (!text) return ''

    // 截断过长的文本
    if (text.length > this.config.maxLength!) {
      return text.slice(0, this.config.maxLength!) + '...'
    }

    return text
  }

  /**
   * 投影工具调用
   */
  projectToolCall(toolName: string, args?: unknown): ProjectedMessage {
    const content = args
      ? `调用工具: ${toolName}(${this.truncateJSON(args)})`
      : `调用工具: ${toolName}`

    return {
      type: 'tool-call',
      content,
      timestamp: Date.now(),
      metadata: { toolName, args },
    }
  }

  /**
   * 投影工具结果
   */
  projectToolResult(toolName: string, result: unknown): ProjectedMessage {
    let content: string

    if (this.config.compactToolResults) {
      content = this.compactResult(result)
    } else {
      content = JSON.stringify(result, null, 2)
    }

    return {
      type: 'tool-result',
      content: `${toolName} 结果: ${this.truncateText(content, 500)}`,
      timestamp: Date.now(),
      metadata: { toolName, result },
    }
  }

  /**
   * 投影阶段变化
   */
  projectPhaseChange(phase: string): ProjectedMessage {
    const phaseNames: Record<string, string> = {
      OBSERVE: '观察',
      THINK: '思考',
      PLAN: '规划',
      BUILD: '构建',
      EXECUTE: '执行',
      VERIFY: '验证',
      LEARN: '学习',
      DONE: '完成',
    }

    return {
      type: 'phase-change',
      content: `进入阶段: ${phaseNames[phase] || phase}`,
      timestamp: Date.now(),
      metadata: { phase },
    }
  }

  /**
   * 投影错误
   */
  projectError(error: Error | string): ProjectedMessage {
    const content = typeof error === 'string' ? error : error.message

    return {
      type: 'error',
      content: `错误: ${content}`,
      timestamp: Date.now(),
      metadata: { error: content },
    }
  }

  /**
   * 批量投影工具结果
   */
  private projectToolResults(results: unknown[]): string {
    return results
      .map((r, i) => {
        if (typeof r === 'string') return r
        if (typeof r === 'object' && r !== null) {
          const obj = r as Record<string, unknown>
          if (obj.type === 'tool-result') {
            return this.projectToolResult(
              obj.toolName as string,
              obj.result
            ).content
          }
        }
        return `结果 ${i + 1}: ${this.truncateText(String(r), 200)}`
      })
      .join('\n')
  }

  /**
   * 紧凑化结果
   */
  private compactResult(result: unknown): string {
    if (result === null || result === undefined) {
      return '(空)'
    }

    if (typeof result === 'string') {
      return this.truncateText(result, 200)
    }

    if (typeof result === 'number' || typeof result === 'boolean') {
      return String(result)
    }

    if (Array.isArray(result)) {
      return `数组(${result.length}项)`
    }

    if (typeof result === 'object') {
      const keys = Object.keys(result as object)
      return `对象(${keys.slice(0, 3).join(', ')}${keys.length > 3 ? '...' : ''})`
    }

    return String(result)
  }

  /**
   * 截断文本
   */
  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text
    return text.slice(0, maxLength - 3) + '...'
  }

  /**
   * 截断 JSON
   */
  private truncateJSON(obj: unknown): string {
    const str = JSON.stringify(obj)
    return this.truncateText(str, 100)
  }
}
