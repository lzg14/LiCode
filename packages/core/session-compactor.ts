import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'fs'
import { join } from 'path'
import { devLogger } from './dev-logger'

/**
 * Session 历史压缩器
 * 当对话过长时将旧消息压缩为摘要，减少传给 LLM 的上下文量。
 *
 * 核心策略：
 * 1. LLM 总结（主动调用，同步等待）—— 生成连贯摘要
 * 2. 降级：LLM 不可用时用规则提取生成摘要
 *
 * 完整历史保留在 SQLite 中不删，摘要写入 Markdown 文件。
 */

export interface ExtractionResult {
  userIntents: string[]
  fileOps: string[]
  commands: string[]
  conclusions: string[]
}

export interface CompactionConfig {
  /** 触发压缩的消息数阈值 */
  maxMessages: number
  /** 触发压缩的 token 数阈值（估） */
  maxTokens: number
  /** 压缩后保留的最近消息数 */
  preserveRecent: number
  /** 防抖间隔（ms），同一 session 压缩后此时间内不再压缩 */
  debounceMs: number
  /** 摘要文件输出目录（metaDir 的父级） */
  dataDir: string
}

export interface CompactionResult {
  summary: string
  summaryPath: string
  preservedCount: number
  originalCount: number
  /** 是否为降级摘要（LLM 不可用时） */
  wasFallback?: boolean
}

const DEFAULT_CONFIG: CompactionConfig = {
  maxMessages: 200,
  /**  token 估算用 length/4（中英文混合粗估），阈值 20 万 = ~80 万字符 */
  maxTokens: 200_000,
  preserveRecent: 30,
  /** 10 分钟内不重复压缩 */
  debounceMs: 600_000,
  dataDir: '',
}

export class SessionCompactor {
  private config: CompactionConfig
  /** 记录每个 session 上次压缩时间（防抖） */
  private lastCompactTime = new Map<string, number>()

  constructor(config: Partial<CompactionConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  // ─── 公开方法 ─────────────────────────────────────────

  /**
   * 判断是否需要压缩
   * @param contextWindow 可选，传入 model 的 context window，触发阈值 = contextWindow * 0.8
   */
  shouldCompact(messages: any[], sessionId: string, contextWindow?: number): boolean {
    const now = Date.now()
    const lastTime = this.lastCompactTime.get(sessionId) ?? 0
    if (now - lastTime < this.config.debounceMs) return false

    const msgCount = messages.length
    const estimatedTokens = this.estimateTokens(messages)

    // 优先用传入的 contextWindow * 0.8，否则用配置的 maxTokens
    const tokenThreshold = contextWindow ? Math.floor(contextWindow * 0.8) : this.config.maxTokens

    if (msgCount >= this.config.maxMessages) {
      devLogger.debug('COMPACTOR', `msgCount=${msgCount} >= ${this.config.maxMessages}, will compact`)
      return true
    }

    if (estimatedTokens >= tokenThreshold) {
      devLogger.debug('COMPACTOR', `tokens=${estimatedTokens} >= ${tokenThreshold} (${contextWindow ? `80% of ${contextWindow}` : `maxTokens`}), will compact`)
      return true
    }

    return false
  }

  /**
   * 执行压缩
   * 优先使用 LLM 生成连贯摘要，失败时降级为规则提取
   */
  async compact(
    messages: any[],
    sessionId: string,
    llm?: { complete: (req: any) => Promise<any> },
  ): Promise<CompactionResult> {
    const now = Date.now()
    this.lastCompactTime.set(sessionId, now)

    const preserveRecent = this.config.preserveRecent
    const total = messages.length
    const toCompact = total > preserveRecent ? messages.slice(0, total - preserveRecent) : []
    const preserved = total > preserveRecent ? messages.slice(total - preserveRecent) : messages

    if (toCompact.length === 0) {
      return {
        summary: '',
        summaryPath: '',
        preservedCount: preserved.length,
        originalCount: total,
      }
    }

    // 1. 优先尝试 LLM 生成摘要
    let summaryBody: string
    let wasFallback = false

    if (llm) {
      try {
        summaryBody = await this.summarizeWithLLM(toCompact, llm)
      } catch (e) {
        // LLM 失败，降级为规则提取
        devLogger.warn('COMPACTOR', `LLM summarization failed, falling back to rules: ${e}`)
        const extraction = this.extractRules(toCompact)
        summaryBody = this.buildFallbackSummary(extraction)
        wasFallback = true
      }
    } else {
      // 无 LLM，直接规则提取
      const extraction = this.extractRules(toCompact)
      summaryBody = this.buildFallbackSummary(extraction)
      wasFallback = true
    }

    // 2. 清理 LLM 输出中的 thinking 标签
    summaryBody = this.stripXmlTags(summaryBody)

    // 3. 构建完整摘要
    const summary = this.buildSummaryDocument(summaryBody, total, preserved.length)

    // 4. 保存
    const summaryPath = this.saveSummary(sessionId, summary)

    return {
      summary: summaryBody,
      summaryPath,
      preservedCount: preserved.length,
      originalCount: total,
      wasFallback,
    }
  }

  /**
   * 加载最新的摘要内容（用于注入 LLM 上下文）
   */
  loadLatestSummary(sessionId: string): string | null {
    const dir = this.summaryDir(sessionId)
    if (!existsSync(dir)) return null

    // 找最新的 summary-vN.md
    let latestVersion = 0
    let latestPath = ''
    for (let v = 1; ; v++) {
      const p = join(dir, `summary-v${v}.md`)
      if (existsSync(p)) {
        latestVersion = v
        latestPath = p
      } else {
        break
      }
    }

    if (!latestPath) return null

    const content = readFileSync(latestPath, 'utf-8')
    // 只返回摘要正文（去掉元数据头）
    const body = this.extractSummaryBody(content)
    return body
  }

  /**
   * 获取 summary 目录（用于外部判断是否有摘要）
   */
  getSummaryDir(sessionId: string): string {
    return this.summaryDir(sessionId)
  }

  hasSummary(sessionId: string): boolean {
    const dir = this.summaryDir(sessionId)
    if (!existsSync(dir)) return false
    return existsSync(join(dir, 'summary-v1.md'))
  }

  // ─── LLM 总结 ─────────────────────────────────────────

  private async summarizeWithLLM(
    messages: any[],
    llm: { complete: (req: any) => Promise<any> },
  ): Promise<string> {
    const conversationText = this.formatMessagesForSummary(messages)

    const prompt = `你是一个对话摘要助手。请根据以下对话记录，写一段 3-5 句的连贯摘要，说明：
1）做了什么任务
2）有什么技术决策
3）项目当前状态

直接输出摘要正文，不要前缀说明，不要输出任何 XML 标签（如 <think>）。

## 对话记录
${conversationText}`

    const response = await llm.complete({
      model: '',
      messages: [
        { role: 'system', content: '你是对话摘要助手，直接输出摘要正文，不要其他内容。' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      maxTokens: 600,
    })

    return response.content ?? ''
  }

  private formatMessagesForSummary(messages: any[]): string {
    const parts: string[] = []

    for (const msg of messages) {
      const role = msg.role ?? 'unknown'
      const content = msg.content ?? []

      if (role === 'user') {
        for (const part of content) {
          if (part.type === 'text' && part.text) {
            const trimmed = part.text.trim().slice(0, 200)
            if (trimmed) parts.push(`[用户]: ${trimmed}`)
          }
        }
      } else if (role === 'assistant') {
        for (const part of content) {
          if (part.type === 'text' && part.text) {
            const trimmed = part.text.trim().slice(0, 300)
            if (trimmed) parts.push(`[助手]: ${trimmed}`)
          }
          if (part.type === 'tool-call' && part.toolName) {
            const input = part.input ?? {}
            const desc = this.summarizeToolCall(part.toolName, input)
            if (desc) parts.push(`[工具调用]: ${desc}`)
          }
        }
      } else if (role === 'tool') {
        for (const part of content) {
          if (part.type === 'tool-result') {
            const output = String(part.output ?? '').slice(0, 100)
            if (output) parts.push(`[工具结果]: ${output}`)
          }
        }
      }
    }

    return parts.slice(0, 50).join('\n') // 限制 50 行，避免 prompt 过长
  }

  private summarizeToolCall(toolName: string, input: any): string {
    switch (toolName) {
      case 'read':
        return `读取 ${input.path ?? ''}`
      case 'write':
        return `写入 ${input.path ?? ''}`
      case 'edit':
        return `编辑 ${input.path ?? ''}`
      case 'bash':
        return `执行 ${String(input.command ?? '').slice(0, 60)}`
      case 'grep':
        return `搜索 ${input.pattern ?? ''}`
      case 'glob':
        return `查找 ${input.pattern ?? ''}`
      default:
        return `${toolName}`
    }
  }

  // ─── 规则提取（降级方案）─────────────────────────────────

  private extractRules(messages: any[]): ExtractionResult {
    const userIntents: string[] = []
    const fileOps: string[] = []
    const commands: string[] = []
    const conclusions: string[] = []

    for (const msg of messages) {
      const role = msg.role ?? 'unknown'
      const content = msg.content ?? []

      if (role === 'user') {
        for (const part of content) {
          if (part.type === 'text' && part.text) {
            const trimmed = part.text.trim().slice(0, 80)
            if (trimmed) userIntents.push(trimmed)
          }
        }
      }

      if (role === 'assistant' || role === 'tool') {
        for (const part of content) {
          if (part.type === 'reasoning' && part.text) {
            const text = part.text.trim().slice(0, 150)
            if (text && !conclusions.includes(text)) conclusions.push(`[思考] ${text}`)
          }
          if (part.type === 'tool-call' && part.toolName) {
            if (['read', 'write', 'edit', 'bash', 'grep', 'glob'].includes(part.toolName)) {
              const input = part.input ?? {}
              const path = input.path ?? input.pattern ?? ''
              if (path && !fileOps.includes(String(path))) fileOps.push(String(path))
              if (part.toolName === 'bash') {
                const cmd = String(input.command ?? '').slice(0, 60)
                if (cmd && !commands.includes(cmd)) commands.push(cmd)
              }
            }
          }
          if (part.type === 'text' && part.text) {
            const text = part.text.trim()
            if (text.length > 20) {
              const lastPara = text.split('\n\n').filter(Boolean).pop() ?? ''
              const short = lastPara.slice(0, 120)
              if (short && !conclusions.includes(short)) conclusions.push(short)
            }
          }
        }
      }
    }

    return { userIntents, fileOps, commands, conclusions }
  }

  private buildFallbackSummary(extraction: ExtractionResult): string {
    const parts: string[] = []

    if (extraction.userIntents.length > 0) {
      parts.push(`用户进行了以下操作：${extraction.userIntents.slice(0, 5).join('；')}`)
    }

    if (extraction.fileOps.length > 0) {
      parts.push(`涉及文件：${extraction.fileOps.slice(0, 5).join('、')}`)
    }

    if (extraction.commands.length > 0) {
      parts.push(`执行命令：${extraction.commands.slice(0, 3).join('；')}`)
    }

    if (extraction.conclusions.length > 0) {
      parts.push(`关键结论：${extraction.conclusions.slice(0, 3).join('；')}`)
    }

    return parts.join('\n') || '暂无摘要内容'
  }

  // ─── 持久化 ─────────────────────────────────────────

  private summaryDir(sessionId: string): string {
    return join(this.config.dataDir, 'memory', 'sessions', sessionId)
  }

  private buildSummaryDocument(body: string, originalCount: number, preservedCount: number): string {
    const now = new Date()
    const localDate = now.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-')
    const localTime = now.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false })
    return [
      `# 对话摘要（截至 ${localDate} ${localTime}）`,
      ``,
      `原始消息 ${originalCount} 条，保留最近 ${preservedCount} 条完整消息。`,
      ``,
      body,
      ``,
      `---`,
      ``,
    ].join('\n')
  }

  private saveSummary(sessionId: string, summary: string): string {
    const dir = this.summaryDir(sessionId)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    // 确定版本号
    let version = 1
    while (existsSync(join(dir, `summary-v${version}.md`))) {
      version++
    }

    const filePath = join(dir, `summary-v${version}.md`)
    writeFileSync(filePath, summary, 'utf-8')

    // 也追加到累积摘要文件
    const accumPath = join(dir, 'summary.md')
    appendFileSync(accumPath, `\n\n${summary}`, 'utf-8')

    return filePath
  }

  private extractSummaryBody(content: string): string {
    const lines = content.split('\n')
    const bodyStart = lines.findIndex(l => l.startsWith('## 对话') || l.startsWith('## 关键') || l.startsWith('用户') || l.startsWith('涉及'))
    if (bodyStart < 0) return content
    return lines.slice(bodyStart).join('\n').trim()
  }

  // ─── 工具方法 ─────────────────────────────────────────

  /**
   * 清理 LLM 输出中的 thinking/system-reminder 等 XML 标签
   */
  private stripXmlTags(text: string): string {
    return text
      .replace(/<think>[\s\S]*?<\/think>/g, '')
      .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }

  private estimateTokens(messages: any[]): number {
    let total = 0
    for (const msg of messages) {
      const content = msg.content ?? []
      for (const part of content) {
        if (part?.type === 'text' && part?.text) {
          total += part.text.length
        } else if (part?.type === 'tool-result' && part?.output?.value) {
          // tool-result 的 value 是字符串，取其长度
          total += typeof part.output.value === 'string' ? part.output.value.length : JSON.stringify(part.output.value).length
        } else if (part?.type === 'tool-call' && part?.input) {
          // tool-call 的 input 参数
          total += JSON.stringify(part.input).length
        } else if (typeof part === 'string') {
          total += part.length
        }
      }
    }
    // 除以 4：中英文混合，每 token ≈ 4 字符
    return Math.ceil(total / 4)
  }
}
