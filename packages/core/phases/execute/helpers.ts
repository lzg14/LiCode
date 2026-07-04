import type { MessageContent } from "./context"

function collectToolIds(msgs: Array<{ role: string; content: MessageContent[] }>, start: number): { calls: Set<string>; results: Set<string> } {
  const calls = new Set<string>()
  const results = new Set<string>()
  for (let j = start; j < msgs.length; j++) {
    const m = msgs[j]
    if (Array.isArray(m.content)) {
      for (const p of m.content) {
        if (p.type === 'tool-call') calls.add(p.toolCallId)
        if (p.type === 'tool-result') results.add(p.toolCallId)
      }
    }
  }
  return { calls, results }
}

/**
 * 判断从指定位置开始的消息块是否存在 orphan tool-result
 * （有 tool-result 但缺少对应的 tool-call）
 */
function hasOrphanFrom(msgs: Array<{ role: string; content: MessageContent[] }>, start: number): boolean {
  const { calls, results } = collectToolIds(msgs, start)
  for (const rid of results) {
    if (!calls.has(rid)) return true
  }
  return false
}

/**
 * 找到合法的起始位置：确保 tool-call/tool-result 配对完整
 *
 * 当 history 被 slice 截断时，开头可能出现 orphan tool-result（对应的 assistant+tool-call 被截掉）。
 * 算法：从第一个 user 消息开始扫描，找到第一个不包含 orphan 的位置。
 * 复杂度：O(n * m)，n = 消息数，m = 平均每条消息的 parts 数。
 */
export function findValidStart(msgs: Array<{ role: string; content: MessageContent[] }>): number {
  // 第一步：收集全局 tool-call 和 tool-result ID
  const allToolCallIds = new Set<string>()
  const allToolResultIds = new Set<string>()
  for (const m of msgs) {
    if (Array.isArray(m.content)) {
      for (const p of m.content) {
        if (p.type === 'tool-call') allToolCallIds.add(p.toolCallId)
        if (p.type === 'tool-result') allToolResultIds.add(p.toolCallId)
      }
    }
  }

  // 第二步：检查是否有 orphan tool-result
  for (const rid of allToolResultIds) {
    if (!allToolCallIds.has(rid)) {
      // 存在 orphan，找第一个无 orphan 的 user 消息位置
      for (let i = 0; i < msgs.length; i++) {
        if (msgs[i].role === 'user' && !hasOrphanFrom(msgs, i)) {
          return i
        }
      }
      return 0
    }
  }
  return 0
}
