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
  test("优先返回 token.raw", () => {
    const token = { type: "text", raw: "raw text", text: "alt text" } as any
    expect(tokenText(token)).toBe("raw text")
  })

  test("raw 不存在时返回 text", () => {
    const token = { type: "text", text: "just text" } as any
    expect(tokenText(token)).toBe("just text")
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
