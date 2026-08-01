import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
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

/** 压缩器内部使用的消息结构（比 session/types.ts 的 Message 更宽松） */
export interface CompactionMessage {
  role: string
  content: Array<{
    type: string
    text?: string
    toolName?: string
    input?: Record<string, unknown>
    output?: unknown
    toolCallId?: string
  }> | string
}

/** LLM 完成函数接口 */
export interface LLMCompleteFn {
  complete: (req: { messages: CompactionMessage[]; system?: string; model: string; temperature?: number; maxTokens?: number }) => Promise<{ content?: string }>
}

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
  /** contextWindow 未知（未注册模型）时使用的兜底阈值；取 min(maxTokens, unknownModelThreshold) */
  unknownModelThreshold: number
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
  /** 触发压缩的消息数阈值（1000：提高避免频繁压缩） */
  maxMessages: 1000,
  /**  token 估算用 length/4（中英文混合粗估），阈值 20 万 = ~80 万字符 */
  maxTokens: 200_000,
  /** 未注册模型时兜底阈值（10 万 tokens），避免 fallback 到 maxTokens=200K 永远不触发 */
  unknownModelThreshold: 100_000,
  /** 压缩后保留的最近消息数（100：保留更多上下文给 LLM） */
  preserveRecent: 100,
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

  get preserveRecent(): number {
    return this.config.preserveRecent
  }

  // ─── 公开方法 ─────────────────────────────────────────

  /**
   * 判断是否需要压缩
   * @param contextWindow 可选，传入 model 的 context window，触发阈值 = contextWindow * 0.8
   */
  shouldCompact(messages: CompactionMessage[], sessionId: string, contextWindow?: number): boolean {
    const now = Date.now()
    const lastTime = this.lastCompactTime.get(sessionId) ?? 0
    if (now - lastTime < this.config.debounceMs) return false

    const msgCount = messages.length
    const estimatedTokens = this.estimateTokens(messages)

    // 优先用传入的 contextWindow * 0.8，否则用 unknownModelThreshold / maxTokens 取较小者
    // 关键：maxTokens=200K 会让绝大多数模型永远触发不了（contextWindow ≤ 200K），所以未注册模型必须用更紧的兜底
    const tokenThreshold = contextWindow
      ? Math.floor(contextWindow * 0.8)
      : Math.min(this.config.maxTokens, this.config.unknownModelThreshold)

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
    messages: CompactionMessage[],
    sessionId: string,
    llm?: LLMCompleteFn,
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
    let latestPath = ''
    for (let v = 1; ; v++) {
      const p = join(dir, `summary-v${v}.md`)
      if (existsSync(p)) {
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
    messages: CompactionMessage[],
    llm: LLMCompleteFn,
  ): Promise<string> {
    const conversationText = this.formatMessagesForSummary(messages)

    const prompt = `你是一个对话摘要助手。请根据以下对话记录，按结构化格式输出摘要。

## 输出格式

\`\`\`markdown
# Goal
一句话说明当前任务目标

# Constraints & Preferences
- 技术约束、用户偏好、不做什么

# Progress
## Done
- 已完成的关键步骤

## In Progress
- 正在进行的工作

## Blocked
- 被阻塞的事项（如有）

# Key Decisions
- 重要的技术选型或设计决策

# Next Steps
- 接下来要做的事

# Critical Context
- 测试状态、版本号、关键配置等影响后续工作的信息
\`\`\`

## 规则
- 每个 section 用 1-5 个 bullet point，不要长段落
- Done 和 In Progress 按时间倒序排列（最新的在前）
- 如果某个 section 无内容，写"（无）"
- 直接输出 markdown，不要包裹在 \`\`\` 代码块中
- 不要输出 <think> 标签

## 对话记录
${conversationText}`

    const response = await llm.complete({
      model: '',
      messages: [
        { role: 'system', content: '你是对话摘要助手，按指定的 markdown 结构输出摘要，不要包裹在代码块中，不要输出其他内容。' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      maxTokens: 800,
    })

    return response.content ?? ''
  }

  private formatMessagesForSummary(messages: CompactionMessage[]): string {
    const parts: string[] = []

    for (const msg of messages) {
      const role = msg.role ?? 'unknown'
      const content = msg.content

      if (typeof content === 'string') {
        // content 是字符串，直接使用
        if (role === 'user') {
          const trimmed = content.trim().slice(0, 200)
          if (trimmed) parts.push(`[用户]: ${trimmed}`)
        } else if (role === 'assistant') {
          const trimmed = content.trim().slice(0, 300)
          if (trimmed) parts.push(`[助手]: ${trimmed}`)
        }
        continue
      }

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

  private summarizeToolCall(toolName: string, input: Record<string, unknown>): string {
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

  private extractRules(messages: CompactionMessage[]): ExtractionResult {
    const userIntents: string[] = []
    const fileOps: string[] = []
    const commands: string[] = []
    const conclusions: string[] = []

    for (const msg of messages) {
      const role = msg.role ?? 'unknown'
      const content = msg.content

      if (typeof content === 'string') {
        // content 是字符串，直接使用
        if (role === 'user') {
          const trimmed = content.trim().slice(0, 80)
          if (trimmed) userIntents.push(trimmed)
        }
        continue
      }

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
    const lines: string[] = []

    lines.push('# Goal')
    if (extraction.userIntents.length > 0) {
      lines.push(extraction.userIntents[0])
    } else {
      lines.push('（无）')
    }

    lines.push('')
    lines.push('# Constraints & Preferences')
    lines.push('（无）')

    lines.push('')
    lines.push('# Progress')
    lines.push('## Done')
    if (extraction.fileOps.length > 0) {
      for (const f of extraction.fileOps.slice(0, 5)) {
        lines.push(`- 修改 \`${f}\``)
      }
    }
    if (extraction.commands.length > 0) {
      for (const c of extraction.commands.slice(0, 3)) {
        lines.push(`- 执行 \`${c}\``)
      }
    }
    if (extraction.fileOps.length === 0 && extraction.commands.length === 0) {
      lines.push('（无）')
    }

    lines.push('')
    lines.push('## In Progress')
    lines.push('（无）')

    lines.push('')
    lines.push('## Blocked')
    lines.push('（无）')

    lines.push('')
    lines.push('# Key Decisions')
    if (extraction.conclusions.length > 0) {
      for (const c of extraction.conclusions.slice(0, 3)) {
        lines.push(`- ${c}`)
      }
    } else {
      lines.push('（无）')
    }

    lines.push('')
    lines.push('# Next Steps')
    lines.push('（无）')

    lines.push('')
    lines.push('# Critical Context')
    lines.push('（规则提取降级，无 LLM 参与）')

    return lines.join('\n')
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

  private estimateTokens(messages: CompactionMessage[]): number {
    let total = 0
    for (const msg of messages) {
      const content = msg.content
      if (typeof content === 'string') {
        total += content.length
      } else if (Array.isArray(content)) {
        for (const part of content) {
          if (part.type === 'text' && part.text) {
            total += part.text.length
          } else if (part.type === 'tool-result' && part.output && typeof part.output === 'object' && 'value' in part.output) {
            // tool-result 的 value 是字符串，取其长度
            const value = (part.output as { value: unknown }).value
            total += typeof value === 'string' ? value.length : JSON.stringify(value).length
          } else if (part.type === 'tool-call' && part.input) {
            // tool-call 的 input 参数
            total += JSON.stringify(part.input).length
          }
        }
      }
    }
    // 除以 4：中英文混合，每 token ≈ 4 字符
    return Math.ceil(total / 4)
  }
}
