export interface PerfSpan {
  id: string
  name: string
  startMs: number
  endMs?: number
  durationMs?: number
  parent?: string
  meta?: Record<string, unknown>
}

export interface PerfTrace {
  sessionId?: string
  turnIndex: number
  spans: PerfSpan[]
  totalMs: number
  startedAt: number
  endedAt: number
}

export class Timer {
  private spans: PerfSpan[] = []
  private stack: string[] = []
  private startTime: number
  private turnIndex: number
  private counter = 0

  constructor(turnIndex = 0) {
    this.startTime = performance.now()
    this.turnIndex = turnIndex
  }

  /**
   * 开始一个 span。返回 id，配合 end() 使用。
   * 例如:
   *   const id = timer.start('llm.call', { model: '...' })
   *   ...
   *   timer.end(id)
   */
  start(name: string, meta?: Record<string, unknown>): string {
    this.counter += 1
    const id = `${name}#${this.counter}`
    const span: PerfSpan = {
      id,
      name,
      startMs: this.now(),
      meta,
    }
    if (this.stack.length > 0) {
      span.parent = this.stack[this.stack.length - 1]
    }
    this.spans.push(span)
    this.stack.push(id)
    return id
  }

  end(id: string, meta?: Record<string, unknown>): void {
    const span = this.spans.find(s => s.id === id)
    if (!span || span.endMs !== undefined) return
    span.endMs = this.now()
    span.durationMs = span.endMs - span.startMs
    if (meta) span.meta = { ...span.meta, ...meta }
    const idx = this.stack.indexOf(id)
    if (idx >= 0) this.stack.splice(idx, 1)
  }

  /** 自动按"最后未结束"语义结束一个同名 span —— 适合固定配对的场景 */
  checkpoint(name: string, meta?: Record<string, unknown>): void {
    for (let i = this.spans.length - 1; i >= 0; i--) {
      const s = this.spans[i]
      if (s.name === name && s.endMs === undefined) {
        s.endMs = this.now()
        s.durationMs = s.endMs - s.startMs
        if (meta) s.meta = { ...s.meta, ...meta }
        const stackIdx = this.stack.indexOf(s.id)
        if (stackIdx >= 0) this.stack.splice(stackIdx, 1)
        return
      }
    }
    this.start(name, meta)
  }

  now(): number {
    return performance.now() - this.startTime
  }

  getSpans(): PerfSpan[] {
    return [...this.spans]
  }

  /** 输出耗时最多的 span，按 durationMs 降序 */
  topSlowest(n = 5): PerfSpan[] {
    return [...this.spans]
      .filter(s => s.durationMs !== undefined)
      .sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))
      .slice(0, n)
  }

  /**
   * 按名称前缀汇总耗时。
   * 例：totalByPrefix('llm.') 把所有 llm.generateText / llm.something 的 duration 加起来。
   */
  totalByPrefix(prefix: string): { count: number; totalMs: number } {
    let count = 0
    let total = 0
    for (const s of this.spans) {
      if (s.name.startsWith(prefix) && s.durationMs !== undefined) {
        count++
        total += s.durationMs
      }
    }
    return { count, totalMs: total }
  }

  /**
   * 把关键类别的耗时汇总：llm（实际调大模型）、tool（工具调用）、
   * phase（编排开销）、save/memory（持久化）。
   */
  summary(): Record<string, { count: number; totalMs: number; pctOfTotal: number }> {
    const totalMs = this.now()
    const groups: Record<string, { count: number; totalMs: number }> = {
      llm: this.totalByPrefix('llm.'),
      tool: this.totalByPrefix('tool.'),
      phase: this.totalByPrefix('phase.'),
      history: this.totalByPrefix('history.'),
      save: this.totalByPrefix('save.'),
      memory: this.totalByPrefix('memory.'),
    }
    const out: Record<string, { count: number; totalMs: number; pctOfTotal: number }> = {}
    for (const [k, v] of Object.entries(groups)) {
      if (v.count === 0) continue
      out[k] = {
        count: v.count,
        totalMs: Math.round(v.totalMs * 10) / 10,
        pctOfTotal: totalMs > 0 ? Math.round((v.totalMs / totalMs) * 1000) / 10 : 0,
      }
    }
    return out
  }

  /** 构建完整的 trace，可用于持久化或回调 */
  buildTrace(sessionId?: string): PerfTrace {
    const total = this.now()
    return {
      sessionId,
      turnIndex: this.turnIndex,
      spans: [...this.spans],
      totalMs: total,
      startedAt: this.startTime,
      endedAt: this.startTime + total,
    }
  }

  /** 人类可读的层级摘要。root spans 一级，子 span 缩进两级 */
  format(): string {
    const rootSpans = this.spans.filter(s => !s.parent)
    const lines: string[] = []

    const renderSpan = (s: PerfSpan, depth: number) => {
      const dur = s.durationMs !== undefined ? `${s.durationMs.toFixed(1)}ms` : '...'
      const prefix = '  '.repeat(depth) + '- '
      const bar = '█'.repeat(Math.min(40, Math.round((s.durationMs ?? 0) / 50)))
      lines.push(`${prefix}${s.name.padEnd(28)} ${dur.padStart(10)}  ${bar}`)
      const children = this.spans.filter(c => c.parent === s.id)
      for (const c of children.sort((a, b) => a.startMs - b.startMs)) {
        renderSpan(c, depth + 1)
      }
    }

    for (const s of rootSpans.sort((a, b) => a.startMs - b.startMs)) {
      renderSpan(s, 0)
    }
    return lines.join('\n')
  }
}