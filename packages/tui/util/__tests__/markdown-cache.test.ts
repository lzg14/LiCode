import { describe, expect, test } from "bun:test"
import { ensureMessageTokens, tokenText, hasInlineTokens, type CachedMessage } from "../markdown-cache"

describe("ensureMessageTokens", () => {
  test("第一次解析后缓存到 msg.tokens", () => {
    const msg: CachedMessage = { id: "1", content: "# Hello\n\nThis is **bold** text." }
    const tokens1 = ensureMessageTokens(msg)
    expect(tokens1.length).toBeGreaterThan(0)
    expect(msg.tokens).toBeDefined()
    expect(msg._cachedContent).toBe(msg.content)
  })

  test("二次调用同一 msg 返回同一 tokens 引用（cache hit）", () => {
    const msg: CachedMessage = { id: "1", content: "# Hello" }
    const tokens1 = ensureMessageTokens(msg)
    const tokens2 = ensureMessageTokens(msg)
    expect(tokens2).toBe(tokens1) // 引用相等，无重 parse
  })

  test("content 变化时重新解析并更新 cache", () => {
    const msg: CachedMessage = { id: "1", content: "first" }
    const tokens1 = ensureMessageTokens(msg)
    msg.content = "second"
    const tokens2 = ensureMessageTokens(msg)
    expect(tokens2).not.toBe(tokens1)
    expect(msg._cachedContent).toBe("second")
  })

  test("复杂 markdown 解析正确", () => {
    const msg: CachedMessage = {
      id: "1",
      content: `# Title

Paragraph with **bold**, *italic*, and \`code\`.

- Item 1
- Item 2

\`\`\`js
const x = 1
\`\`\`
`,
    }
    const tokens = ensureMessageTokens(msg)
    const types = tokens.map((t) => t.type)
    expect(types).toContain("heading")
    expect(types).toContain("paragraph")
    expect(types).toContain("list")
    expect(types).toContain("code")
  })
})

describe("tokenText", () => {
  test("优先返回 token.text（纯文本，不含 markdown 语法符号）", () => {
    // heading: raw="### Title" 含 #，text="Title" 不含 #
    const token = { type: "heading", raw: "### Title", text: "Title" } as any
    expect(tokenText(token)).toBe("Title")
    expect(tokenText(token)).not.toContain("#")
  })

  test("strong: raw='**bold**' → 返回 text='bold'", () => {
    const token = { type: "strong", raw: "**bold**", text: "bold" } as any
    expect(tokenText(token)).toBe("bold")
    expect(tokenText(token)).not.toContain("**")
  })

  test("link: raw='[text](url)' → 返回 text='text'", () => {
    const token = { type: "link", raw: "[text](url)", text: "text", href: "url" } as any
    expect(tokenText(token)).toBe("text")
    expect(tokenText(token)).not.toContain("[")
    expect(tokenText(token)).not.toContain("(")
  })

  test("text 不存在时 fallback 到 raw", () => {
    const token = { type: "text", raw: "just raw" } as any
    expect(tokenText(token)).toBe("just raw")
  })

  test("都不存在时返回空字符串", () => {
    const token = { type: "space" } as any
    expect(tokenText(token)).toBe("")
  })
})

describe("hasInlineTokens", () => {
  test("有 inline tokens 时返回 true", () => {
    const token = {
      type: "paragraph",
      tokens: [{ type: "text", raw: "hi" }],
    } as any
    expect(hasInlineTokens(token)).toBe(true)
  })

  test("空 tokens 数组返回 false", () => {
    const token = { type: "paragraph", tokens: [] } as any
    expect(hasInlineTokens(token)).toBe(false)
  })

  test("没有 tokens 字段返回 false", () => {
    const token = { type: "space" } as any
    expect(hasInlineTokens(token)).toBe(false)
  })
})

describe("heading token（回归: renderHeading 不应显示 ### 前缀）", () => {
  // 背景：static-markdown renderHeading 之前会把 "#".repeat(depth) + " " 拼到 inline 前
  // 导致 markdown 语法符号 ###/#### 出现在终端渲染结果里
  // 修复后 renderHeading 用 heading.text / inlineTokensToText 取纯文本
  // 这里回归 marked 解析结果：保证我们能拿到的 text/inline tokens 不含前缀

  test("# 一级 heading: heading.text 是纯文本不含 #", () => {
    const msg: CachedMessage = { id: "1", content: "# Title 1" }
    const tokens = ensureMessageTokens(msg)
    const heading = tokens.find((t) => t.type === "heading") as any
    expect(heading).toBeDefined()
    expect(heading.depth).toBe(1)
    expect(heading.text).toBe("Title 1")
    expect(heading.text).not.toContain("#")
  })

  test("### 三级 heading: heading.text 是纯文本不含 ###", () => {
    const msg: CachedMessage = { id: "1", content: "### 4 个新 bug 优先级" }
    const tokens = ensureMessageTokens(msg)
    const heading = tokens.find((t) => t.type === "heading") as any
    expect(heading).toBeDefined()
    expect(heading.depth).toBe(3)
    expect(heading.text).toBe("4 个新 bug 优先级")
    expect(heading.text).not.toContain("#")
  })

  test("#### 四级 heading: heading.text 是纯文本不含 ####", () => {
    const msg: CachedMessage = { id: "1", content: "#### 🚨 Bug4: z.any() 透传" }
    const tokens = ensureMessageTokens(msg)
    const heading = tokens.find((t) => t.type === "heading") as any
    expect(heading).toBeDefined()
    expect(heading.depth).toBe(4)
    expect(heading.text).toBe("🚨 Bug4: z.any() 透传")
    expect(heading.text).not.toContain("#")
  })

  test("heading 内的 inline tokens 拍平也是纯文本（fallback 路径）", () => {
    // 即使 heading.text 为空（极端情况），inlineTokensToText fallback 也要拿纯文本
    const msg: CachedMessage = { id: "1", content: "## 普通标题" }
    const tokens = ensureMessageTokens(msg)
    const heading = tokens.find((t) => t.type === "heading") as any
    expect(heading).toBeDefined()
    expect(hasInlineTokens(heading)).toBe(true)
    // inline tokens 拍平：text token 的 raw 也不含 #
    const flat = heading.tokens
      .map((t: any) => t.raw || t.text || "")
      .join("")
    expect(flat).toBe("普通标题")
    expect(flat).not.toContain("#")
  })

  test("文档原文片段验证: 4 个 bug 标题渲染后不含 markdown 前缀", () => {
    // 模拟 roadmap 文档里的 heading 列表，回归用户实际场景
    const content = [
      "#### 🚨 Bug4: MCP 工具 z.any() 透传（安全问题）",
      "#### ⚠️ Bug5: createModel 重试是死代码",
      "#### ⚠️ Bug6: SessionCompactor.lastCompactTime 内存泄漏",
      "#### ⚠️ Bug7: MCP withConnection 是空壳",
    ].join("\n\n")
    const msg: CachedMessage = { id: "1", content }
    const tokens = ensureMessageTokens(msg)
    const headings = tokens.filter((t) => t.type === "heading") as any[]
    expect(headings.length).toBe(4)
    expect(headings.every((h) => h.depth === 4)).toBe(true)
    expect(headings.every((h) => !h.text.includes("#"))).toBe(true)
    expect(headings[0].text).toBe("🚨 Bug4: MCP 工具 z.any() 透传（安全问题）")
    expect(headings[1].text).toBe("⚠️ Bug5: createModel 重试是死代码")
    expect(headings[2].text).toBe("⚠️ Bug6: SessionCompactor.lastCompactTime 内存泄漏")
    expect(headings[3].text).toBe("⚠️ Bug7: MCP withConnection 是空壳")
  })
})
