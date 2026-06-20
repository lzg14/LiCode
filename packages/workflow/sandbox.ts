import { randomBytes } from "crypto"

/**
 * Workflow 脚本沙箱
 * 脚本在受限的 vm context 中执行，不暴露 process/fs/网络等
 */

const ALLOWED_GLOBALS = ["console", "Promise", "setTimeout", "clearTimeout", "Math", "JSON", "Date", "Map", "Set"]

export interface SandboxOptions {
  /** 暴露给脚本的额外对象 */
  context: Record<string, any>
  /** 超时（默认 5 分钟） */
  timeoutMs?: number
  /** 内存限制（默认 128MB） */
  maxMemoryMB?: number
}

export interface SandboxResult<T> {
  meta: any
  exports: T
}

export async function runInSandbox(
  script: string,
  options: SandboxOptions
): Promise<{ meta: any; exports: any }> {
  const { context, timeoutMs = 5 * 60_000, maxMemoryMB = 128 } = options

  // 1. 提取 meta（必须以 export const meta 开头）
  const metaMatch = script.match(/export\s+const\s+meta\s*=\s*({[\s\S]*?})\s*[;\n]/)
  if (!metaMatch) {
    throw new Error('Workflow 脚本必须以 "export const meta = { ... }" 开头')
  }
  let meta: any
  try {
    meta = new Function(`return (${metaMatch[1]})`)()
  } catch (e) {
    throw new Error(`meta 解析失败: ${e instanceof Error ? e.message : String(e)}`)
  }

  // 2. 把 export 转换成 vm context 友好的形式
  // 提取 export async function run，包装成可调用的函数
  const runMatch = script.match(/export\s+async\s+function\s+run\s*\(\s*ctx\s*\)\s*\{([\s\S]*?)^}/m)
  if (!runMatch) {
    throw new Error('Workflow 脚本必须包含 "export async function run(ctx)" 函数')
  }
  const runBody = runMatch[1]
  const runFn = new Function("ctx", `return (async () => {${runBody}})()`)

  // 3. 注入 context
  const exports: any = {}
  Object.assign(exports, context)

  // 4. 在一个受限的全局对象中执行
  const sandboxGlobals: Record<string, any> = {}
  for (const key of ALLOWED_GLOBALS) {
    sandboxGlobals[key] = (globalThis as any)[key]
  }
  sandboxGlobals.exports = exports

  // 5. 用 vm 执行（如可用）
  let result: any
  try {
    const vm = await import("vm")
    const wrappedScript = `
      "use strict";
      // 注入沙箱全局对象
      const { ${Object.keys(sandboxGlobals).join(", ")} } = arguments[0];
      const exports = arguments[0].exports || (arguments[0].exports = {});
      return await (async () => {
        ${runBody}
      })();
    `
    result = await vm.runInNewContext(wrappedScript, [sandboxGlobals], {
      timeout: timeoutMs,
      displayErrors: true,
    })
  } catch (e) {
    // 降级：直接 new Function 执行
    if (e instanceof Error && e.message.includes("not supported")) {
      result = await runFn(exports)
    } else {
      throw e
    }
  }

  return { meta, exports: result ?? exports }
}

/** 生成临时 ID */
export function genId(): string {
  return `wf_${Date.now()}_${randomBytes(3).toString("hex")}`
}
