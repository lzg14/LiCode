import { describe, it, expect } from 'vitest'
import { deriveThinkingDisplay } from '../thinking-display'

describe('deriveThinkingDisplay', () => {
  // ─── 状态 1: 只有 thinking ──────────────────
  it('streaming + only thinking → thinking-only', () => {
    const r = deriveThinkingDisplay('<thinking>analyzing</thinking>', false)
    expect(r.kind).toBe('thinking-only')
    if (r.kind === 'thinking-only') {
      expect(r.text).toBe('analyzing')
    }
  })

  it('streaming + multi-line thinking → thinking-only', () => {
    const r = deriveThinkingDisplay('<thinking>line1\nline2</thinking>', false)
    expect(r.kind).toBe('thinking-only')
  })

  it('streaming + unclosed thinking (no </thinking>) → no-thinking', () => {
    const r = deriveThinkingDisplay('<thinking>still going', false)
    expect(r.kind).toBe('no-thinking')
    if (r.kind === 'no-thinking') {
      expect(r.rest).toBe('<thinking>still going')
    }
  })

  // ─── 状态 2: thinking + 正文 ──────────────────
  it('streaming + thinking + rest → has-rest', () => {
    const r = deriveThinkingDisplay('<thinking>thinking</thinking>\nanswer', false)
    expect(r.kind).toBe('has-rest')
    if (r.kind === 'has-rest') {
      expect(r.thinking).toBe('thinking')
      expect(r.rest).toBe('answer')
    }
  })

  it('streaming + thinking + rest + trailing newline → thinking-only (rest empty after trim)', () => {
    const r = deriveThinkingDisplay('<thinking>x</thinking>\n\n\n', false)
    expect(r.kind).toBe('thinking-only')
    if (r.kind === 'thinking-only') {
      expect(r.text).toBe('x')
    }
  })

  it('streaming + thinking + rest + newlines before rest → strip', () => {
    const r = deriveThinkingDisplay('<thinking>x</thinking>\n\nanswer', false)
    expect(r.kind).toBe('has-rest')
    if (r.kind === 'has-rest') expect(r.rest).toBe('answer')
  })

  // ─── 状态 3: 完成后 ─────────────────────────
  it('complete + only thinking → no-thinking (drop thinking)', () => {
    const r = deriveThinkingDisplay('<thinking>only thinking</thinking>', true)
    expect(r.kind).toBe('no-thinking')
    if (r.kind === 'no-thinking') {
      expect(r.rest).toBe('')
    }
  })

  it('complete + thinking + rest → has-rest (show rest)', () => {
    const r = deriveThinkingDisplay('<thinking>think</thinking>\nanswer', true)
    expect(r.kind).toBe('has-rest')
    if (r.kind === 'has-rest') {
      expect(r.rest).toBe('answer')
    }
  })

  it('complete + no thinking → no-thinking', () => {
    const r = deriveThinkingDisplay('just an answer', true)
    expect(r.kind).toBe('no-thinking')
    if (r.kind === 'no-thinking') {
      expect(r.rest).toBe('just an answer')
    }
  })

  // ─── 状态 4: 无内容 ─────────────────────────
  it('empty string streaming → empty', () => {
    const r = deriveThinkingDisplay('', false)
    expect(r.kind).toBe('empty')
  })

  it('empty string complete → empty', () => {
    const r = deriveThinkingDisplay('', true)
    expect(r.kind).toBe('empty')
  })

  it('only whitespace streaming → empty', () => {
    const r = deriveThinkingDisplay('   \n  ', false)
    expect(r.kind).toBe('empty')
  })

  // ─── 边界情况 ─────────────────────────
  it('multiple thinking blocks → only first', () => {
    const r = deriveThinkingDisplay(
      '<thinking>first</thinking>middle<thinking>second</thinking>rest', false)
    expect(r.kind).toBe('has-rest')
    if (r.kind === 'has-rest') {
      expect(r.thinking).toBe('first')
      expect(r.rest).toBe('middle<thinking>second</thinking>rest')
    }
  })

  it('thinking in middle (not at start) → has-rest with full', () => {
    const r = deriveThinkingDisplay('before<thinking>mid</thinking>after', false)
    expect(r.kind).toBe('has-rest')
    if (r.kind === 'has-rest') {
      expect(r.thinking).toBe('mid')
      expect(r.rest).toBe('before after')
    }
  })
})
