import { describe, expect, it, vi } from "vitest"
import { runTUI } from "../../tui/app"

describe("cli index", () => {
  it("runTUI is importable from tui/app", () => {
    expect(typeof runTUI).toBe("function")
  })

  it("index.ts imports runTUI from the correct module", async () => {
    // Verify the import path resolves correctly by checking the source
    const fs = await import("node:fs")
    const path = await import("node:path")
    const indexContent = fs.readFileSync(
      path.resolve(__dirname, "../index.ts"),
      "utf-8",
    )
    expect(indexContent).toContain('from "../tui/app"')
    expect(indexContent).toContain("runTUI")
  })

  it("index.ts calls runTUI and catches errors", async () => {
    const fs = await import("node:fs")
    const path = await import("node:path")
    const indexContent = fs.readFileSync(
      path.resolve(__dirname, "../index.ts"),
      "utf-8",
    )
    expect(indexContent).toContain("runTUI()")
    expect(indexContent).toContain(".catch(console.error)")
  })

  it("index.ts has shebang for direct execution", async () => {
    const fs = await import("node:fs")
    const path = await import("node:path")
    const indexContent = fs.readFileSync(
      path.resolve(__dirname, "../index.ts"),
      "utf-8",
    )
    expect(indexContent.startsWith("#!/usr/bin/env bun")).toBe(true)
  })
})