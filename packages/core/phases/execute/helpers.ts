/**
 * 找到合法的起始位置：确保 tool-call/tool-result 配对完整
 * 当 history 被 slice 截断时，开头可能出现 orphan tool-result（对应的 assistant+tool-call 被截掉）
 */
export function findValidStart(msgs: Array<{ role: string; content: any[] }>): number {
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
  for (const rid of allToolResultIds) {
    if (!allToolCallIds.has(rid)) {
      for (let i = 0; i < msgs.length; i++) {
        if (msgs[i].role === 'user') {
          const chunkCalls = new Set<string>()
          const chunkResults = new Set<string>()
          for (let j = i; j < msgs.length; j++) {
            const m = msgs[j]
            if (Array.isArray(m.content)) {
              for (const p of m.content) {
                if (p.type === 'tool-call') chunkCalls.add(p.toolCallId)
                if (p.type === 'tool-result') chunkResults.add(p.toolCallId)
              }
            }
          }
          let hasOrphan = false
          for (const rid of chunkResults) {
            if (!chunkCalls.has(rid)) { hasOrphan = true; break }
          }
          if (!hasOrphan) return i
        }
      }
      return 0
    }
  }
  return 0
}
