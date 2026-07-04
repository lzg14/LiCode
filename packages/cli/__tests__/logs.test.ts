import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"

const DEV_LOG_DIR = join(homedir(), ".licode", "logs", "dev")
const TEST_LOG = join(DEV_LOG_DIR, "dev-test.log")

beforeAll(() => {
  mkdirSync(DEV_LOG_DIR, { recursive: true })
  writeFileSync(
    TEST_LOG,
    "[INFO] info message\n[ERROR] error occurred\n[WARN] warning",
    "utf-8",
  )
})

afterAll(() => {
  try {
    rmSync(join(homedir(), ".licode"), { recursive: true, force: true })
  } catch {}
})

describe("logs CLI", () => {
  const origArgv = process.argv

  afterEach(() => {
    process.argv = origArgv
  })

  it("--help 输出用法信息", async () => {
    const mod = await import("../logs")
    const spy = vi.spyOn(console, "log").mockImplementation(() => {})
    process.argv = ["bun", "logs.ts", "--help"]
    mod.main()
    const output = spy.mock.calls.map((c) => c[0]).join("\n")
    expect(output).toContain("用法")
    spy.mockRestore()
  })

  it("列出最近日志文件", async () => {
    const mod = await import("../logs")
    const spy = vi.spyOn(console, "log").mockImplementation(() => {})
    process.argv = ["bun", "logs.ts"]
    mod.main()
    const output = spy.mock.calls.map((c) => c[0]).join("\n")
    expect(output).toContain("dev-test.log")
    spy.mockRestore()
  })

  it("--level ERROR 只显示 ERROR 行", async () => {
    const mod = await import("../logs")
    const spy = vi.spyOn(console, "log").mockImplementation(() => {})
    process.argv = ["bun", "logs.ts", "--level", "ERROR"]
    mod.main()
    const output = spy.mock.calls.map((c) => c[0]).join("\n")
    expect(output).toContain("[ERROR] error occurred")
    expect(output).not.toContain("[INFO] info message")
    spy.mockRestore()
  })

  it("--search 过滤关键词", async () => {
    const mod = await import("../logs")
    const spy = vi.spyOn(console, "log").mockImplementation(() => {})
    process.argv = ["bun", "logs.ts", "--search", "warning"]
    mod.main()
    const output = spy.mock.calls.map((c) => c[0]).join("\n")
    expect(output).toContain("[WARN] warning")
    expect(output).not.toContain("[ERROR] error occurred")
    spy.mockRestore()
  })

  it("--tail 限制行数", async () => {
    const mod = await import("../logs")
    const spy = vi.spyOn(console, "log").mockImplementation(() => {})
    process.argv = ["bun", "logs.ts", "--tail", "1"]
    mod.main()
    const output = spy.mock.calls.map((c) => c[0]).join("\n")
    expect(output).toContain("[WARN] warning")
    expect(output).not.toContain("[ERROR] error occurred")
    spy.mockRestore()
  })
})
