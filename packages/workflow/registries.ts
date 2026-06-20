import type { ScriptRegistry } from "./engine"
import { join } from "path"
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { homedir } from "os"

/**
 * 内存版脚本注册器
 */
export class InMemoryScriptRegistry implements ScriptRegistry {
  private scripts = new Map<string, string>()

  get(name: string): string | null {
    return this.scripts.get(name) ?? null
  }

  set(name: string, script: string): void {
    this.scripts.set(name, script)
  }

  list(): string[] {
    return Array.from(this.scripts.keys())
  }
}

/**
 * 文件系统脚本注册器
 * 从 ~/.licode/workflows/ 和 ./.licode/workflows/ 加载 .js 文件
 */
export class FileSystemScriptRegistry implements ScriptRegistry {
  protected scripts = new Map<string, string>()

  constructor(private dirs: string[] = []) {
    this.loadAll()
  }

  private get defaultDirs(): string[] {
    if (this.dirs.length > 0) return this.dirs
    const home = homedir()
    return [
      join(home, ".licode", "workflows"),
      join(process.cwd(), ".licode", "workflows"),
    ]
  }

  loadAll(): void {
    for (const dir of this.defaultDirs) {
      if (!existsSync(dir)) {
        try { mkdirSync(dir, { recursive: true }) } catch {}
        continue
      }
      try {
        const fs = require("fs") as typeof import("fs")
        const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js"))
        for (const file of files) {
          const name = file.replace(/\.js$/, "")
          const content = readFileSync(join(dir, file), "utf-8")
          this.scripts.set(name, content)
        }
      } catch {}
    }
  }

  get(name: string): string | null {
    if (!this.scripts.has(name)) this.loadAll()
    return this.scripts.get(name) ?? null
  }

  set(name: string, script: string): void {
    this.scripts.set(name, script)
    // 持久化到第一个可写目录
    const dir = this.defaultDirs[0]
    try {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, `${name}.js`), script, "utf-8")
    } catch {}
  }

  list(): string[] {
    this.loadAll()
    return Array.from(this.scripts.keys())
  }
}
