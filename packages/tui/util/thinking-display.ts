export type ThinkingDisplay =
  | { kind: 'empty' }
  | { kind: 'thinking-only', text: string }
  | { kind: 'has-rest', thinking: string, rest: string }
  | { kind: 'no-thinking', rest: string }

// 匹配 <thinking>...</thinking> 或 <think>...</think>
const THINKING_REGEX = /<thinking>([\s\S]*?)<\/thinking>|<think>([\s\S]*?)<\/think>/g

/**
 * 从 streaming 文本推导应显示什么
 * @param raw LLM 实时输出（含 <thinking> 或 <think> 标签）
 * @param isComplete 消息是否已完成（不再变化）
 */
export function deriveThinkingDisplay(
  raw: string,
  isComplete: boolean
): ThinkingDisplay {
  const cleaned = raw.trim()
  if (!cleaned) return { kind: 'empty' }

  // 匹配第一个 thinking 块
  THINKING_REGEX.lastIndex = 0
  const match = THINKING_REGEX.exec(cleaned)

  if (!match) {
    // 没 thinking 标签
    return { kind: 'no-thinking', rest: cleaned }
  }

  const thinking = (match[1] ?? match[2] ?? '').trim()
  const before = cleaned.slice(0, match.index).trim()
  const after = cleaned.slice(match.index + match[0].length).trim()
  const rest = [before, after].filter(Boolean).join(' ').trim()

  // 没正文 → 只有 thinking
  if (!rest) {
    if (isComplete) {
      // 完成后只有 thinking，不显示
      return { kind: 'no-thinking', rest: '' }
    }
    return { kind: 'thinking-only', text: thinking }
  }

  // 有 thinking + 正文：总是显示正文（不管 complete 还是 streaming）
  return { kind: 'has-rest', thinking, rest }
}
