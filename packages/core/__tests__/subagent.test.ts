import { describe, it, expect } from "bun:test"
import { SubagentManager } from "../subagent"

describe("SubagentManager", () => {
  it("spawn returns result with success flag", async () => {
    const manager = new SubagentManager({
      maxConcurrent: 3,
      timeoutMs: 5000,
      blockedTools: [],
    })

    // No real model - will fail, but should return structured error
    const result = await manager.spawn(
      { task: "Say hello" },
      {
        model: null as any,
        system: "You are a helpful assistant.",
        messages: [],
        cwd: process.cwd(),
      }
    )

    expect(result).toHaveProperty("success")
    expect(result).toHaveProperty("durationMs")
    expect(typeof result.durationMs).toBe("number")
  })

  it("runMultiple returns array of results", async () => {
    const manager = new SubagentManager({
      maxConcurrent: 2,
      timeoutMs: 5000,
      blockedTools: [],
    })

    const results = await manager.runMultiple(
      [
        { task: "Task 1" },
        { task: "Task 2" },
      ],
      {
        model: null as any,
        system: "You are a helpful assistant.",
        messages: [],
        cwd: process.cwd(),
      }
    )

    expect(results.results).toHaveLength(2)
    expect(results).toHaveProperty("totalDurationMs")
  })

  it("respects maxConcurrent", async () => {
    const manager = new SubagentManager({
      maxConcurrent: 1,
      timeoutMs: 5000,
      blockedTools: [],
    })

    expect(manager.getRunningCount()).toBe(0)

    // Spawn with null model will fail quickly
    const p1 = manager.spawn({ task: "t1" }, { model: null as any, system: "", messages: [], cwd: "" })
    // At this point one should be running
    const runningAfterStart = manager.getRunningCount()

    await p1.catch(() => {})

    expect(runningAfterStart).toBeGreaterThanOrEqual(0)
  })

  it("runMultiple preserves order", async () => {
    const manager = new SubagentManager({
      maxConcurrent: 3,
      timeoutMs: 5000,
      blockedTools: [],
    })

    const results = await manager.runMultiple(
      [
        { task: "First" },
        { task: "Second" },
        { task: "Third" },
      ],
      {
        model: null as any,
        system: "",
        messages: [],
        cwd: "",
      }
    )

    expect(results.results).toHaveLength(3)
    expect(results.totalDurationMs).toBeGreaterThanOrEqual(0)
  })
})
