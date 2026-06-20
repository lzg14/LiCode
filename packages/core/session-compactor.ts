import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'fs'
import { join, dirname } from 'path'

/**
 * Session 历史压缩器
 * 当对话过长时将旧消息压缩为摘要，减少传给 LLM 的上下文量。
 *
 * 核心策略：
 * 1. 规则提取（同步，无 API 调用）—— 提取意图、工具调用、结论
 * 2. LLM 精炼（异步，有 API 调用）—— 将骨架润色为连贯摘要
 * 3. 降级：LLM 不可用时只用规则提取
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
}

const DEFAULT_CONFIG: CompactionConfig = {
  maxMessages: 200,
  maxTokens: 100000,
  preserveRecent: 30,
  debounceMs: 300_000,
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
   */
  shouldCompact(messages: any[], sessionId: string): boolean {
    const now = Date.now()
    const lastTime = this.lastCompactTime.get(sessionId) ?? 0
    if (now - lastTime < this.config.debounceMs) return false

    if (messages.length >= this.config.maxMessages) return true

    const tokens = this.estimateTokens(messages)
    return tokens >= this.config.maxTokens
  }

  /**
   * 执行压缩（同步：规则提取 + 降级摘要立即返回）
   * 异步：LLM 精炼在后台执行，完成后写入文件
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

    // 1. 规则提取（同步，立即返回）
    const extraction = this.extractRules(toCompact)
    const summaryBody = this.buildFallbackSummary(extraction)

    // 2. 构建完整摘要（带元数据头）
    const summary = this.buildSummaryDocument(summaryBody, total, preserved.length)

    // 3. 写入文件（立即写降级摘要，后续 LLM 精炼会追加）
    this.saveSummary(sessionId, summary)

    // 4. LLM 精炼（异步，不阻塞）
    if (llm && toCompact.length > 0) {
      this.refineWithLLM(extraction, llm)
        .then((refinedBody) => {
          const refinedSummary = this.buildSummaryDocument(refinedBody, total, preserved.length)
          this.saveSummary(sessionId, refinedSummary)
        })
        .catch(() => {
          // 降级摘要已经写入，不需要处理
        })
    }

    return {
      summary: summaryBody,
      summaryPath: '',
      preservedCount: preserved.length,
      originalCount: total,
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

  // ─── 规则提取 ─────────────────────────────────────────

  private extractRules(messages: any[]): ExtractionResult {
    const userIntents: string[] = []
    const fileOps: string[] = []
    const commands: string[] = []
    const conclusions: string[] = []

    for (const msg of messages) {
      const role = msg.role ?? 'unknown'
      const content = msg.content ?? []

      if (role === 'user') {
        // 取用户消息的前 80 字作为意图
        for (const part of content) {
          if (part.type === 'text' && part.text) {
            const trimmed = part.text.trim().slice(0, 80)
            if (trimmed) userIntents.push(trimmed)
          }
        }
      }

      if (role === 'assistant' || role === 'tool') {
        for (const part of content) {
          // 工具调用 → 提取文件名
          if (part.type === 'tool-call' && part.toolName) {
            if (['read', 'write', 'edit', 'delete', 'move', 'copy', 'glob', 'grep', 'codesearch', 'bash'].includes(part.toolName)) {
              const input = part.input ?? {}
              const path = input.path ?? input.file ?? input.pattern ?? ''
              if (path) {
                const str = String(path)
                if (!fileOps.includes(str)) fileOps.push(str)
              }
              if (part.toolName === 'bash') {
                const cmd = String(input.command ?? '').slice(0, 60)
                if (cmd && !commands.includes(cmd)) commands.push(cmd)
              }
            }
          }
          // assistant 文本 → 取最后一段作为结论
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

  // ─── LLM 精炼 ─────────────────────────────────────────

  private async refineWithLLM(
    extraction: ExtractionResult,
    llm: { complete: (req: any) => Promise<any> },
  ): Promise<string> {
    const prompt = `请将以下对话记录整理为一段简洁连贯的摘要，保留技术决策和项目上下文。

## 用户意图
${extraction.userIntents.map(s => `- ${s}`).join('\n')}

## 涉及的文件
${extraction.fileOps.map(s => `- ${s}`).join('\n') || '(无)'}

## 执行的命令
${extraction.commands.map(s => `- ${s}`).join('\n') || '(无)'}

## 关键结论
${extraction.conclusions.map(s => `- ${s}`).join('\n') || '(无)'}

请输出 2-4 段话，介绍这段时间做了什么、有什么技术决策、项目当前状态。不要用列表格式，用连贯的段落。`

    const response = await llm.complete({
      model: '',
      messages: [
        { role: 'system', content: '你是一个对话摘要助手，只输出摘要正文，不要其他内容。' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      maxTokens: 800,
    })

    return response.content ?? this.buildFallbackSummary(extraction)
  }

  // ─── 降级摘要 ─────────────────────────────────────────

  private buildFallbackSummary(extraction: ExtractionResult): string {
    const parts: string[] = []

    if (extraction.userIntents.length > 0) {
      parts.push(`## 对话纪要\n\n${extraction.userIntents.slice(0, 10).map(s => `- ${s}`).join('\n')}`)
    }

    if (extraction.fileOps.length > 0) {
      parts.push(`## 涉及文件\n\n${extraction.fileOps.slice(0, 15).map(s => `- ${s}`).join('\n')}`)
    }

    if (extraction.commands.length > 0) {
      parts.push(`## 执行命令\n\n${extraction.commands.slice(0, 10).map(s => `- ${s}`).join('\n')}`)
    }

    if (extraction.conclusions.length > 0) {
      parts.push(`## 关键结论\n\n${extraction.conclusions.slice(0, 8).map(s => `- ${s}`).join('\n')}`)
    }

    return parts.join('\n\n') || '(暂无摘要内容)'
  }

  // ─── 持久化 ─────────────────────────────────────────

  private summaryDir(sessionId: string): string {
    return join(this.config.dataDir, 'memory', 'sessions', sessionId)
  }

  private buildSummaryDocument(body: string, originalCount: number, preservedCount: number): string {
    const now = new Date().toISOString().slice(0, 16).replace('T', ' ')
    return [
      `# 对话摘要（截至 ${now}）`,
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
    // 去掉元数据头（## 对话摘要 和 --- 之间的内容取后半段）
    const lines = content.split('\n')
    const bodyStart = lines.findIndex(l => l.startsWith('## 对话') || l.startsWith('## 关键'))
    if (bodyStart < 0) return content
    return lines.slice(bodyStart).join('\n').trim()
  }

  // ─── 工具方法 ─────────────────────────────────────────

  private estimateTokens(messages: any[]): number {
    let total = 0
    for (const msg of messages) {
      const content = msg.content ?? []
      for (const part of content) {
        if (typeof part === 'object') {
          total += JSON.stringify(part).length
        } else if (typeof part === 'string') {
          total += part.length
        }
      }
    }
    return Math.ceil(total / 3)
  }
}
