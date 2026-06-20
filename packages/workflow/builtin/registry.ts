import { FileSystemScriptRegistry } from "../workflow"
import codingScript from "../workflow/builtin/coding.js"
import researchScript from "../workflow/builtin/research.js"
import reviewScript from "../workflow/builtin/review.js"

const BUILTIN: Record<string, string> = {
  coding: codingScript,
  research: researchScript,
  review: reviewScript,
}

/**
 * 内置 + 文件系统脚本注册器
 * 优先查找内置，fallback 到文件系统
 */
export class BuiltinScriptRegistry extends FileSystemScriptRegistry {
  constructor(dirs: string[] = []) {
    super(dirs)
    // 预置内置脚本
    for (const [name, script] of Object.entries(BUILTIN)) {
      this.scripts.set(name, script)
    }
  }
}
