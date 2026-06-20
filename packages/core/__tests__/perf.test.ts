import { describe, it, expect } from 'vitest'
import { Timer } from '../perf'

describe('Timer', () => {
  it('records a simple span', async () => {
    const timer = new Timer()
    const id = timer.start('test')
    await new Promise(r => setTimeout(r, 10))
    timer.end(id)
    const spans = timer.getSpans()
    expect(spans).toHaveLength(1)
    expect(spans[0].name).toBe('test')
    expect(spans[0].durationMs).toBeGreaterThanOrEqual(8)
  })

  it('supports nested spans with parent', async () => {
    const timer = new Timer()
    const outer = timer.start('outer')
    await new Promise(r => setTimeout(r, 5))
    const inner = timer.start('inner')
    await new Promise(r => setTimeout(r, 5))
    timer.end(inner)
    timer.end(outer)

    const spans = timer.getSpans()
    const innerSpan = spans.find(s => s.name === 'inner')!
    const outerSpan = spans.find(s => s.name === 'outer')!
    expect(innerSpan.parent).toBe(outer)
    expect(outerSpan.parent).toBeUndefined()
    expect(innerSpan.startMs).toBeGreaterThanOrEqual(outerSpan.startMs)
    expect(outerSpan.durationMs).toBeGreaterThan(innerSpan.durationMs ?? 0)
  })

  it('checkpoint records duration automatically', async () => {
    const timer = new Timer()
    timer.checkpoint('phase1')
    await new Promise(r => setTimeout(r, 20))
    timer.checkpoint('phase1')

    const spans = timer.getSpans()
    expect(spans).toHaveLength(1)
    expect(spans[0].durationMs).toBeGreaterThanOrEqual(15)
  })

  it('topSlowest returns slowest spans by duration', async () => {
    const timer = new Timer()
    const fastId = timer.start('fast')
    await new Promise(r => setTimeout(r, 5))
    timer.end(fastId)

    const slowId = timer.start('slow')
    await new Promise(r => setTimeout(r, 30))
    timer.end(slowId)

    const top = timer.topSlowest(2)
    expect(top[0].name).toBe('slow')
    expect(top[1].name).toBe('fast')
    expect(top[0].durationMs).toBeGreaterThan(top[1].durationMs ?? 0)
  })

  it('buildTrace captures session + turnIndex', () => {
    const timer = new Timer(3)
    timer.checkpoint('a')
    const trace = timer.buildTrace('ses_abc')
    expect(trace.sessionId).toBe('ses_abc')
    expect(trace.turnIndex).toBe(3)
    expect(trace.spans.length).toBeGreaterThanOrEqual(1)
  })

  it('format produces hierarchical output', () => {
    const timer = new Timer()
    const outer = timer.start('outer')
    timer.checkpoint('inner')
    timer.end(outer)
    const out = timer.format()
    expect(out).toContain('outer')
    expect(out).toContain('inner')
  })

  it('meta is captured on end', () => {
    const timer = new Timer()
    const id = timer.start('test')
    timer.end(id, { toolCalls: 3 })
    const span = timer.getSpans()[0]
    expect(span.meta?.toolCalls).toBe(3)
  })

  it('totalByPrefix aggregates durations', () => {
    const timer = new Timer()
    const a = timer.start('llm.generateText')
    timer.end(a)
    const b = timer.start('llm.generateText')
    timer.end(b)
    const c = timer.start('tool.read')
    timer.end(c)
    const llm = timer.totalByPrefix('llm.')
    const tool = timer.totalByPrefix('tool.')
    expect(llm.count).toBe(2)
    expect(tool.count).toBe(1)
    expect(llm.totalMs).toBeGreaterThanOrEqual(0)
  })

  it('summary separates llm/tool/phase', async () => {
    const timer = new Timer()
    const a = timer.start('llm.generateText')
    await new Promise(r => setTimeout(r, 10))
    timer.end(a)
    const b = timer.start('tool.bash')
    await new Promise(r => setTimeout(r, 5))
    timer.end(b)
    const c = timer.start('phase.EXECUTE')
    await new Promise(r => setTimeout(r, 2))
    timer.end(c)

    const s = timer.summary()
    expect(s.llm.count).toBe(1)
    expect(s.llm.totalMs).toBeGreaterThanOrEqual(8)
    expect(s.tool.count).toBe(1)
    expect(s.tool.totalMs).toBeGreaterThanOrEqual(3)
    expect(s.phase.count).toBe(1)
    expect(s.llm.pctOfTotal).toBeGreaterThan(0)
    expect(s.llm.pctOfTotal + s.tool.pctOfTotal + s.phase.pctOfTotal).toBeGreaterThan(0)
  })
})