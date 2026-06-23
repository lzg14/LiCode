/**
 * 流式输出段累积器
 *
 * 将 LLM 的流式 chunk 切分为已闭合段（thinking / system-reminder / text）
 * 和未闭合的 pending 文本，实现渐进式展示。
 *
 * 兼容两种 thinking 标签格式：`<thinking>` 和 `<think>`
 */

export type SegmentKind = 'thinking' | 'system-reminder' | 'text'

export interface Segment {
  kind: SegmentKind
  text: string
}

export interface AccResult {
  closed: Segment[]
  pending: string
  mode: 'text' | 'in-thinking' | 'in-system-reminder'
}

export interface StreamAccumulator {
  push(chunk: string): AccResult
  reset(): void
}

const THINKING_TAGS = ['<thinking>', '<think>']
const THINKING_CLOSE_TAGS = ['</thinking>', '</think>']
const SYSTEM_OPEN = '<system-reminder>'
const SYSTEM_CLOSE = '</system-reminder>'

type Mode = 'text' | 'in-thinking' | 'in-system-reminder'

function findCloseTag(buffer: string, closeTags: string[]): number {
  let minIdx = -1
  for (const tag of closeTags) {
    const idx = buffer.indexOf(tag)
    if (idx !== -1 && (minIdx === -1 || idx < minIdx)) {
      minIdx = idx
    }
  }
  return minIdx
}

function findOpenTag(buffer: string): { idx: number; len: number; kind: 'thinking' | 'system' } | null {
  let best: { idx: number; len: number; kind: 'thinking' | 'system' } | null = null

  for (const tag of THINKING_TAGS) {
    const idx = buffer.indexOf(tag)
    if (idx !== -1 && (!best || idx < best.idx)) {
      best = { idx, len: tag.length, kind: 'thinking' }
    }
  }

  const sysIdx = buffer.indexOf(SYSTEM_OPEN)
  if (sysIdx !== -1 && (!best || sysIdx < best.idx)) {
    best = { idx: sysIdx, len: SYSTEM_OPEN.length, kind: 'system' }
  }

  return best
}

/**
 * 检查 buffer 尾部是否有不完整的开标签前缀
 * 返回可能的标签前缀长度（0 表示没有）
 */
function incompleteTagPrefixLen(buffer: string): number {
  // 检查 <thin... 这种不完整的 thinking 标签
  for (const tag of THINKING_TAGS) {
    for (let i = 1; i < tag.length; i++) {
      if (buffer.endsWith(tag.slice(0, i))) {
        return i
      }
    }
  }
  // 检查 <system-rem... 这种不完整的 system-reminder 标签
  for (let i = 1; i < SYSTEM_OPEN.length; i++) {
    if (buffer.endsWith(SYSTEM_OPEN.slice(0, i))) {
      return i
    }
  }
  return 0
}

export function createStreamAccumulator(): StreamAccumulator {
  let buffer = ''
  let mode: Mode = 'text'

  function push(chunk: string): AccResult {
    buffer += chunk
    const closed: Segment[] = []

    // 循环检测
    let safety = 0
    while (safety++ < 100) {
      if (mode === 'in-thinking') {
        const closeIdx = findCloseTag(buffer, THINKING_CLOSE_TAGS)
        if (closeIdx === -1) break
        const text = buffer.slice(0, closeIdx)
        closed.push({ kind: 'thinking', text })
        // 找到闭合标签的长度
        const closeTag = buffer.startsWith('</thinking>', closeIdx) ? '</thinking>' : '</think>'
        buffer = buffer.slice(closeIdx + closeTag.length)
        mode = 'text'
      } else if (mode === 'in-system-reminder') {
        const closeIdx = buffer.indexOf(SYSTEM_CLOSE)
        if (closeIdx === -1) break
        const text = buffer.slice(0, closeIdx)
        closed.push({ kind: 'system-reminder', text })
        buffer = buffer.slice(closeIdx + SYSTEM_CLOSE.length)
        mode = 'text'
      } else {
        // text 模式
        const open = findOpenTag(buffer)

        if (!open) {
          // 没有开标签，检查是否有不完整的标签前缀
          const prefixLen = incompleteTagPrefixLen(buffer)
          if (prefixLen > 0) {
            // 有不完整的标签前缀，保持 pending
            break
          }
          // 没有不完整的前缀，整个 buffer 都是 text
          if (buffer) {
            closed.push({ kind: 'text', text: buffer })
            buffer = ''
          }
          break
        }

        // 开标签之前的文本作为 text 段
        if (open.idx > 0) {
          closed.push({ kind: 'text', text: buffer.slice(0, open.idx) })
        }
        buffer = buffer.slice(open.idx + open.len)
        mode = open.kind === 'thinking' ? 'in-thinking' : 'in-system-reminder'
      }
    }

    return { closed, pending: buffer, mode }
  }

  function reset() {
    buffer = ''
    mode = 'text'
  }

  return { push, reset }
}
