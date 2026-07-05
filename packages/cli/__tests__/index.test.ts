import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { runTUI } from "../../tui/app"

// bun test 把测试 bundle 到临时目录，__dirname 在 ESM 下会指向 dist/__tests__/
// （不是源码目录）— 改用 import.meta.url 解析源码位置
const __filename = fileURLToPath(import.meta.url)
const __dirnameSrc = dirname(__filename)

describe("cli index", () => {
  it("runTUI is importable from tui/app", () => {
    expect(typeof runTUI).toBe("function")
  })

  it("index.ts imports runTUI from the correct module", async () => {
    const fs = await import("node:fs")
    const indexContent = fs.readFileSync(
      resolve(__dirnameSrc, "../index.ts"),
      "utf-8",
    )
    expect(indexContent).toContain('from "../tui/app"')
    expect(indexContent).toContain("runTUI")
  })

  it("index.ts calls runTUI and catches errors", async () => {
    const fs = await import("node:fs")
    const indexContent = fs.readFileSync(
      resolve(__dirnameSrc, "../index.ts"),
      "utf-8",
    )
    expect(indexContent).toContain("runTUI()")
    expect(indexContent).toContain(".catch(console.error)")
  })

  it("index.ts has shebang for direct execution", async () => {
    const fs = await import("node:fs")
    const indexContent = fs.readFileSync(
      resolve(__dirnameSrc, "../index.ts"),
      "utf-8",
    )
    expect(indexContent.startsWith("#!/usr/bin/env bun")).toBe(true)
  })
})
