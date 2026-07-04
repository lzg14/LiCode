import { describe, expect, it } from "vitest"
import { normalizeModelIdForCatalog, resolveContextWindow } from "../provider"

describe("normalizeModelIdForCatalog", () => {
  it("剥掉 [1M] 等后缀", () => {
    expect(normalizeModelIdForCatalog("MiniMax-M3[1M]")).toBe("MiniMax-M3")
    expect(normalizeModelIdForCatalog("MiniMax-M3[1m]")).toBe("MiniMax-M3")
  })

  it("不带后缀时原样返回", () => {
    expect(normalizeModelIdForCatalog("MiniMax-M3")).toBe("MiniMax-M3")
    expect(normalizeModelIdForCatalog("claude-sonnet-4-20250514")).toBe("claude-sonnet-4-20250514")
  })

  it("多个后缀也只剥最后一个 [xxx]", () => {
    expect(normalizeModelIdForCatalog("foo[bar][baz]")).toBe("foo[bar]")
  })
})

describe("resolveContextWindow", () => {
  it("已知模型直接返回 contextWindow", () => {
    expect(resolveContextWindow("claude-sonnet-4-20250514")).toBe(200000)
    expect(resolveContextWindow("gpt-4o")).toBe(128000)
    expect(resolveContextWindow("deepseek-v4-flash")).toBe(128000)
  })

  it("MiniMax-M3[1M] 走原始字符串查表，命中 1M 版本", () => {
    // 关键：不能用 normalize 后的名字查表，否则会命中 MiniMax-M3 的 128K
    expect(resolveContextWindow("MiniMax-M3[1M]")).toBe(1000000)
  })

  it("MiniMax-M3 不带后缀返回 128K", () => {
    expect(resolveContextWindow("MiniMax-M3")).toBe(128000)
  })

  it("未注册模型返回 undefined", () => {
    expect(resolveContextWindow("totally-unknown-model-xyz")).toBeUndefined()
  })
})