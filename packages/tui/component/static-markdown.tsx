import { createMemo, For, type JSX } from "solid-js"
import { TextAttributes } from "@opentui/core"
import type { Token, Tokens, TokensList } from "marked"
import {
  ensureMessageTokens,
  hasInlineTokens,
  scheduleMessageStyledText,
  tokenText,
  type CachedMessage,
} from "../util/markdown-cache"
import { useTheme } from "../context/theme"
import type { SyntaxStyle } from "@opentui/core"
import { marked } from "marked"

/**
 * StaticMarkdown - 静态 markdown 渲染器
 *
 * 设计目标：
 * - 历史 message 永不重新 parse：tokens 缓存到 message 对象，render 时直接用
 * - 0 闪烁：block 结构 + inline 样式（strong/em/codespan/link）都从 tokens 同步渲染
 * - 0 异步依赖：marked.lexer(content) 是同步的
 * - syntax highlight（代码块 ts/js 等）通过 treeSitterToStyledText 异步叠加（fire-and-forget）
 *
 * 与 OpenTUI <markdown> 组件的关键区别：
 * - 我们缓存了 tokens 到 message 上 → render 永远是 cache hit → 0 重 parse
 * - OpenTUI <markdown> 每次 mount 都要从字符串重新 parse markdown + tree-sitter
 *
 * 已知限制（MVP）：
 * - 代码块 syntax highlight 是异步叠加的（第 1 帧 monospace，后续帧有 color）
 * - inline content 的 syntax highlight（如粗体内的关键字）暂未叠加
 * - table 渲染简化（不绘制边框/对齐），后续可增强
 *
 * 两种用法：
 * 1. 历史 message：<StaticMarkdown msg={msg} syntaxStyle={...} />
 *    → tokens 缓存到 msg 对象，永不重新 parse
 * 2. 临时 content：<StaticMarkdown content={text} syntaxStyle={...} />
 *    → 内部用 createMemo 做组件级缓存（同一 content 不重 parse）
 *    → 用于 streaming segment（thinking/text 段）和 compaction 摘要
 */

interface StaticMarkdownProps {
  /** 历史 message（与 content 二选一） */
  msg?: CachedMessage
  /** 临时 content 字符串（与 msg 二选一） */
  content?: string
  /** 共享 syntaxStyle，避免每实例 createMemo 重建（与原 licode MarkdownText 一致） */
  syntaxStyle?: SyntaxStyle
}

export function StaticMarkdown(props: StaticMarkdownProps): JSX.Element {
  const theme = useTheme()

  // content 模式下的内容级缓存：相同 content 字符串 → 直接复用 tokens
  // 解决 streaming 时 pendingText 每字符变化都触发 marked.lexer 的性能问题
  // 注：Map 在 component function 体内声明 → Solid 组件只跑一次 → Map 生命周期 = 组件实例生命周期
  const contentCache = new Map<string, TokensList>()
  let lastContent: string | undefined = undefined
  let lastTokens: TokensList | null = null

  // 1. 拿 tokens：msg 走缓存，content 走组件级 memo 缓存
  const tokens = createMemo<TokensList>(() => {
    if (props.msg) {
      return ensureMessageTokens(props.msg)
    }
    const c = props.content
    if (c === undefined) return marked.lexer("")
    if (c === lastContent && lastTokens) return lastTokens
    // 缓存命中：相同 content 字符串 → 复用
    const cached = contentCache.get(c)
    if (cached) {
      lastContent = c
      lastTokens = cached
      return cached
    }
    // 缓存未命中：lex + 缓存
    const fresh = marked.lexer(c)
    contentCache.set(c, fresh)
    // 防止内存爆炸：超过 200 条 LRU 截断
    if (contentCache.size > 200) {
      const firstKey = contentCache.keys().next().value
      if (firstKey !== undefined) contentCache.delete(firstKey)
    }
    lastContent = c
    lastTokens = fresh
    return fresh
  })

  // 2. 异步 fire-and-forget：触发 tree-sitter syntax highlight（仅 msg 模式）
  //    content 模式（streaming）不做 syntax highlight —— 高频重 parse 反而卡
  if (props.msg && props.syntaxStyle) {
    scheduleMessageStyledText(props.msg, props.syntaxStyle)
  }

  return (
    <box flexDirection="column">
      <For each={tokens()}>
        {(token) => renderBlock(token, theme)}
      </For>
    </box>
  )
}

// ============================================
// Block 渲染器（顶层 switch on token.type）
// ============================================

function renderBlock(token: Token, theme: ReturnType<typeof useTheme>): JSX.Element {
  switch (token.type) {
    case "heading":
      return renderHeading(token as Tokens.Heading, theme)
    case "paragraph":
      return renderParagraph(token as Tokens.Paragraph, theme)
    case "code":
      return renderCode(token as Tokens.Code, theme)
    case "list":
      return renderList(token as Tokens.List, theme)
    case "blockquote":
      return renderBlockquote(token as Tokens.Blockquote, theme)
    case "hr":
      return (
        <text fg={theme.textMuted()}>{`─`.repeat(40)}</text>
      )
    case "table":
      return renderTable(token as Tokens.Table, theme)
    // space / html / def 等不显式渲染
    default:
      return <></>
  }
}

function renderHeading(token: Tokens.Heading, theme: ReturnType<typeof useTheme>): JSX.Element {
  // heading 不显示 markdown 前缀符号（###/#### 等），只渲染纯文本
  // - 用 BOLD + primary 色作为视觉强调（terminal 字号变化有限，靠颜色区分 depth）
  // - prefix 是 markdown 语法符号，渲染后应丢弃（与 GitHub/Typora 等标准渲染器一致）
  // - 直接用 marked 提取好的 heading.text（已剥离 # 前缀），不走 tokenText
  //   因为 tokenText 优先返回 raw（含 #），对 heading 不适用
  // - fallback 到拍平 inline tokens（极端情况下 text 为空时）
  const inline = (token as Tokens.Heading).text || inlineTokensToText(token.tokens)
  return (
    <box marginTop={1}>
      <text fg={theme.primary()} attributes={TextAttributes.BOLD}>{inline}</text>
    </box>
  )
}

function renderParagraph(token: Tokens.Paragraph, theme: ReturnType<typeof useTheme>): JSX.Element {
  if (hasInlineTokens(token)) {
    // <text> 只能接 string，不能接嵌套 JSX；用 inlineTokensToText 拍平
    return (
      <box>
        <text fg={theme.text()}>{inlineTokensToText(token.tokens)}</text>
      </box>
    )
  }
  const text = (token as unknown as { text?: string }).text ?? (token as unknown as { raw?: string }).raw ?? ""
  return (
    <box>
      <text fg={theme.text()}>{text}</text>
    </box>
  )
}

function renderCode(token: Tokens.Code, theme: ReturnType<typeof useTheme>): JSX.Element {
  // 代码块：box 边框 + monospace 文本
  // 注：暂未叠加 tree-sitter syntax highlight（v2 增强）
  return (
    <box
      border
      borderColor={theme.border()}
      flexDirection="column"
      paddingLeft={1}
      paddingRight={1}
    >
      {token.lang ? (
        <text fg={theme.textMuted()}>{`  ${token.lang}`}</text>
      ) : null}
      <text fg={theme.text()}>{token.text}</text>
    </box>
  )
}

function renderList(token: Tokens.List, theme: ReturnType<typeof useTheme>): JSX.Element {
  const startNum = typeof token.start === "number" ? token.start : 1
  return (
    <box flexDirection="column">
      <For each={token.items}>
        {(item, idx) => {
          const marker = token.ordered ? `${startNum + idx()}. ` : "• "
          const itemText = (item as unknown as { text?: string }).text ?? ""
          return (
            <box flexDirection="row">
              <text fg={theme.textMuted()}>{marker}</text>
              <text fg={theme.text()}>
                {hasInlineTokens(item) ? inlineTokensToText(item.tokens) : itemText}
              </text>
            </box>
          )
        }}
      </For>
    </box>
  )
}

function renderBlockquote(token: Tokens.Blockquote, theme: ReturnType<typeof useTheme>): JSX.Element {
  // 引用：左边框 + 灰色 italic
  // <text> 只能接 string，用 inlineTokensToText 拍平
  const inline = hasInlineTokens(token) ? inlineTokensToText(token.tokens) : ""
  return (
    <box borderColor={theme.textMuted()} border={["left"]} paddingLeft={1}>
      <text fg={theme.textMuted()} attributes={TextAttributes.ITALIC}>{inline}</text>
    </box>
  )
}

function renderTable(token: Tokens.Table, theme: ReturnType<typeof useTheme>): JSX.Element {
  // 表格简化渲染：每行用空格分隔，不做复杂对齐
  // v2 可增强为 grid 模式
  const rows: string[][] = [
    token.header.map((c) => stripTableCell(c.text)),
    ...token.rows.map((row) => row.map((c) => stripTableCell(c.text))),
  ]
  return (
    <box flexDirection="column">
      <For each={rows}>
        {(row, rowIdx) => (
          <box flexDirection="row">
            <For each={row}>
              {(cell) => (
                <text fg={rowIdx() === 0 ? theme.textMuted() : theme.text()}>
                  {`${cell}   `}
                </text>
              )}
            </For>
          </box>
        )}
      </For>
    </box>
  )
}

function stripTableCell(text: string): string {
  return text.replace(/\n/g, " ").trim()
}

// ============================================
// Inline 渲染器（用 OpenTUI Solid 自带的 strong/em/u/a）
// ============================================

/**
 * 渲染 inline tokens 数组为 SolidJS 节点
 * - 递归处理 nested tokens
 * - 用 OpenTUI 内置的 <strong> <em> <u> <a> 处理 marked 的 strong/em/codespan/link
 */
function renderInlineTokens(tokens: Token[], theme: ReturnType<typeof useTheme>): JSX.Element {
  return (
    <For each={tokens}>
      {(token) => renderInlineToken(token, theme)}
    </For>
  )
}

function renderInlineToken(token: Token, theme: ReturnType<typeof useTheme>): JSX.Element {
  // 关键约束：OpenTUI 的 <text> 只接受 string / TextNodeRenderable / StyledText 作为 children，
  // 不接受嵌套 JSX 节点（之前用 <strong>/<em>/<a>/<span> 都会触发
  // "TextNodeRenderable only accepts strings..." 或 "Comp is not a function"）。
  // 因此所有 inline token 必须展平成纯字符串，外层用 fg 表达语义（粗体/斜体在
  // terminal 里只能用 fg 颜色近似）。
  //
  // 嵌套 token（如 strong 包含 em）递归拍平成 raw text，丢失粗体/斜体语义；
  // 这是当前 OpenTUI Solid bindings 的限制，等上游加更多 inline element 再优化。

  switch (token.type) {
    case "text":
      return <text fg={theme.text()}>{(token as Tokens.Text).text}</text>

    case "codespan":
      return <text fg={theme.success()}>{`\`${(token as Tokens.Codespan).text}\``}</text>

    case "br":
      return <text>{"\n"}</text>

    case "strong":
    case "em": {
      // 粗体/斜体：拍平嵌套 token 成字符串，用 primary 色近似视觉强调
      const t = token as Tokens.Strong | Tokens.Em
      const inner = hasInlineTokens(t) ? inlineTokensToText(t.tokens) : tokenText(t)
      return <text fg={theme.primary()}>{inner}</text>
    }

    case "del": {
      // 删除线：OpenTUI 无原生支持，降级用 muted 颜色
      const t = token as Tokens.Del
      const inner = hasInlineTokens(t) ? inlineTokensToText(t.tokens) : tokenText(t)
      return <text fg={theme.textMuted()}>{inner}</text>
    }

    case "link": {
      // 链接：拍平成 "text (url)" 形式（OpenTUI 无可点击 link element）
      const t = token as Tokens.Link
      const inner = hasInlineTokens(t) ? inlineTokensToText(t.tokens) : tokenText(t)
      return <text fg={theme.primary()}>{`${inner} (${t.href})`}</text>
    }

    case "image": {
      const t = token as Tokens.Image
      return <text>{`[${t.text || "image"}: ${t.href || ""}]`}</text>
    }

    case "escape":
      return <text>{(token as Tokens.Escape).text}</text>

    case "html":
      return <text>{(token as Tokens.HTML).text || (token as unknown as { raw?: string }).raw || ""}</text>

    case "checkbox":
      return <text fg={theme.textMuted()}>{(token as Tokens.Checkbox).checked ? "[x] " : "[ ] "}</text>

    default:
      return <text>{(token as unknown as { raw?: string }).raw || (token as unknown as { text?: string }).text || ""}</text>
  }
}

/**
 * 把 inline token 数组递归展平成纯字符串（不含任何 JSX/元素）。
 * 用于解决 OpenTUI <text> 不接受嵌套 JSX 的限制。
 */
function inlineTokensToText(tokens: Token[]): string {
  return tokens
    .map((t) => {
      if (hasInlineTokens(t)) {
        return inlineTokensToText(t.tokens)
      }
      return tokenText(t)
    })
    .join("")
}
