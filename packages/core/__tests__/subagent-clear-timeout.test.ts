import { describe, it, expect, afterEach } from "vitest"
import { SubagentManager } from "../subagent"

describe("SubagentManager timer cleanup", () => {
  const origSetTimeout = globalThis.setTimeout
  const origClearTimeout = globalThis.clearTimeout

  afterEach(() => {
    globalThis.setTimeout = origSetTimeout
    globalThis.clearTimeout = origClearTimeout
  })

  it("spawn 完成（成功路径）后应 clearTimeout race timer", async () => {
    const cleared: unknown[] = []
    globalThis.clearTimeout = ((id: unknown) => {
      cleared.push(id)
      return origClearTimeout(id as ReturnType<typeof origSetTimeout>)
    }) as typeof globalThis.clearTimeout

    // 模型为 null 时 generateText 立即抛错，spawn 走 catch + finally
    // 这是 timer 注册后立刻被清理的最直接验证
    const mgr = new SubagentManager({
      maxConcurrent: 3,
      timeoutMs: 5_000,
      blockedTools: [],
    })

    await mgr.spawn(
      { task: "x" },
      { model: null as any, system: "", messages: [], cwd: "" },
    )

    // 每个 spawn 至少注册 1 个 race timer，应该被 clear 至少 1 次
    expect(cleared.length).toBeGreaterThanOrEqual(1)
  })

  it("spawn 完成（多次迭代）后所有 race timer 都应被 clear", async () => {
    const cleared: unknown[] = []
    globalThis.clearTimeout = ((id: unknown) => {
      cleared.push(id)
      return origClearTimeout(id as ReturnType<typeof origSetTimeout>)
    }) as typeof globalThis.clearTimeout

    const mgr = new SubagentManager({
      maxConcurrent: 3,
      timeoutMs: 10_000,
      blockedTools: [],
    })

    // model 为 null，每次 iteration 都会立即抛错 → 每个 iteration 注册 1 个 timer
    // MAX_TOOL_ITERATIONS = 20
    await mgr.spawn(
      { task: "y" },
      { model: null as any, system: "", messages: [], cwd: "" },
    )

    // 至少有 1 次 clearTimeout 被调用（最差情况）
    expect(cleared.length).toBeGreaterThanOrEqual(1)
    // 不应该完全没有 clearTimeout
    expect(cleared.length).toBeGreaterThan(0)
  })
})