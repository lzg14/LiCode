import { readFileSync } from "fs"
import { dirname, join } from "path"
import { fileURLToPath } from "url"
import { FileSystemScriptRegistry } from "../registries"

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * 内置 + 文件系统脚本注册器
 * 优先查找内置，fallback 到文件系统
 */
export class BuiltinScriptRegistry extends FileSystemScriptRegistry {
  constructor(dirs: string[] = []) {
    super(dirs)
    for (const name of ["coding", "research", "review"]) {
      const script = readFileSync(join(__dirname, `${name}.js`), "utf-8")
      this.scripts.set(name, script)
    }
  }
}
