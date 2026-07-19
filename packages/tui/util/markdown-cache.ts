import { marked, type Token, type TokensList } from "marked"
import {
  getTreeSitterClient,
  type StyledText,
  type SyntaxStyle,
  treeSitterToStyledText,
} from "@opentui/core"

/**
 * Markdown 缓存层
 *
 * 设计原则（解决 licode TUI 渲染卡顿根因）：
 * - 历史 message 必须 "永不重新 parse" —— 解析一次，结果缓存到 message 对象
 * - marked.lexer(content) 是同步的，tokens 完全可序列化
 * - treeSitterToStyledText 是异步的（提供 syntax highlight），不阻塞渲染
 * - 第一帧：用 tokens 同步渲染（无 syntax highlight，但 block 结构 + 行内样式齐全）
 * - 后续帧：async 完成后叠加 syntax highlight（仅 inline 内容有 1 次微切换）
 *
 * 与 OpenTUI <markdown> 组件的对比：
 * - OpenTUI <markdown> 没有 "已 stable 的 message 不重 parse" 保证
 * - 每次 mount / scroll / streaming 切换都可能触发内部重 parse
 * - 我们自己实现，缓存到 message 上，彻底杜绝重 parse
 *
 * 用法：
 *   addMessage({ role: 'assistant', content }) →
 *     ensureMessageTokens(msg)  // 同步，在 addMessage 里调
 *     scheduleMessageStyledText(msg, syntaxStyle)  // 异步 fire-and-forget
 *
 *   render(msg) →
 *     ensureMessageTokens(msg)  // cache hit，立即返回
 *     <StaticMarkdown msg={msg} syntaxStyle={...} />
 */

export interface CachedMessage {
  id: string
  content: string
  /** marked.lexer 缓存，同步；content 不变时直接返回 */
  tokens?: TokensList
  /** 缓存的 content 字符串，用于检测 content 变化时 invalidate tokens */
  _cachedContent?: string
  /** tree-sitter 异步 parse 结果，给 inline content 加 syntax highlight */
  styledText?: StyledText
}

/**
 * 同步：把 markdown 文本解析为 marked tokens，缓存到 message 上
 * - 同步：marked.lexer 是同步的
 * - 幂等：同一 content 只 parse 一次
 * - cache hit 立即返回（O(1)）
 */
export function ensureMessageTokens(msg: CachedMessage): TokensList {
  if (msg.tokens && msg._cachedContent === msg.content) {
    return msg.tokens
  }
  const tokens = marked.lexer(msg.content)
  msg.tokens = tokens
  msg._cachedContent = msg.content
  return tokens
}

/**
 * 异步：用 tree-sitter 给整个 content 加 syntax highlight
 * - 异步：tree-sitter parse 较慢
 * - 幂等：只 parse 一次，结果缓存
 * - 失败：静默 fallback（无 syntax highlight 但不抛错）
 */
export function scheduleMessageStyledText(
  msg: CachedMessage,
  syntaxStyle: SyntaxStyle
): void {
  if (msg.styledText) return
  // fire-and-forget；失败时静默忽略（fallback 到无 highlight）
  treeSitterToStyledText(
    msg.content,
    "markdown",
    syntaxStyle,
    getTreeSitterClient()
  )
    .then((styledText) => {
      msg.styledText = styledText
    })
    .catch((err) => {
      // tree-sitter parse 失败不应阻塞渲染，只是不加 syntax highlight
      console.warn("[markdown-cache] treeSitterToStyledText failed:", err)
    })
}

/**
 * Helper：获取 token 的原始文本
 */
export function tokenText(token: Token): string {
  return token.raw || (token as any).text || ""
}

/**
 * Helper：检查 token 是否有 inline 子 tokens
 */
export function hasInlineTokens(token: Token): token is Token & { tokens: Token[] } {
  return "tokens" in token && Array.isArray((token as any).tokens) && (token as any).tokens.length > 0
}
