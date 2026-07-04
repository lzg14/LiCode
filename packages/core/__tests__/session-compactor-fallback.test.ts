import { describe, it, expect } from "vitest"
import { SessionCompactor, type CompactionConfig } from "../session-compactor"

const BASE_CONFIG: CompactionConfig = {
  maxMessages: 200,
  maxTokens: 200_000,
  unknownModelThreshold: 100_000,
  preserveRecent: 3,
  debounceMs: 0,
  dataDir: "",
}

function makeMessages(count: number, charsPerMsg: number) {
  const msgs: any[] = []
  for (let i = 0; i < count; i++) {
    msgs.push({
      role: "user",
      content: [{ type: "text", text: "x".repeat(charsPerMsg) }],
    })
  }
  return msgs
}

describe("SessionCompactor shouldCompact - unknownModelThreshold fallback", () => {
  it("contextWindow=undefined 且 estimated tokens 超过 unknownModelThreshold 时触发", () => {
    // 100 条消息 × 500 字 = 50000 字 ≈ 12500 tokens（chars/4）
    // unknownModelThreshold=20_000，比 12_500 大，不应触发
    const c1 = new SessionCompactor({ ...BASE_CONFIG, unknownModelThreshold: 20_000 })
    expect(c1.shouldCompact(makeMessages(100, 500), "s1", undefined)).toBe(false)

    // 100 条 × 5000 字 = 500000 字 ≈ 125_000 tokens，超过 20_000 unknownModelThreshold
    const c2 = new SessionCompactor({ ...BASE_CONFIG, unknownModelThreshold: 20_000 })
    expect(c2.shouldCompact(makeMessages(100, 5000), "s2", undefined)).toBe(true)
  })

  it("contextWindow 已知时优先用 80% contextWindow，不用 unknownModelThreshold", () => {
    // contextWindow=10000 → 阈值 8000 tokens = 32000 chars
    // 100 条 × 200 字 = 20000 字 ≈ 5000 tokens，低于 8000，不应触发
    const c = new SessionCompactor({ ...BASE_CONFIG, unknownModelThreshold: 100 })
    expect(c.shouldCompact(makeMessages(100, 200), "s3", 10000)).toBe(false)

    // 100 条 × 1000 字 = 100000 字 ≈ 25_000 tokens，超过 8000 阈值
    expect(c.shouldCompact(makeMessages(100, 1000), "s4", 10000)).toBe(true)
  })

  it("unknownModelThreshold 兜底取 min(maxTokens, unknownModelThreshold)，不会被 maxTokens 拉大", () => {
    // maxTokens=200_000 但 unknownModelThreshold=1000 → 兜底阈值应是 1000
    // 100 条 × 200 字 = 20000 字 ≈ 5000 tokens，超过 1000 应触发
    const c = new SessionCompactor({
      ...BASE_CONFIG,
      maxTokens: 200_000,
      unknownModelThreshold: 1000,
    })
    expect(c.shouldCompact(makeMessages(100, 200), "s5", undefined)).toBe(true)
  })
})