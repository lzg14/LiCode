import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import { getSecurityLayer } from '../../security'
import type { ToolRegistry } from '../registry'
import type { ToolContext } from '../context'

const execFileAsync = promisify(execFile)

function registerApplyPatch(registry: ToolRegistry): void {
  registry.register({
    name: 'apply_patch',
    description: '应用补丁到文件。支持统一 diff 格式（git diff 输出）和结构化 JSON 补丁。',
    inputSchema: z.object({
      filePath: z.string().describe('要修补的文件路径'),
      patch: z.string().describe('补丁内容（unified diff 格式，或 JSON Patch 格式）'),
      reverse: z.boolean().optional().describe('是否反向应用（撤销补丁）'),
    }),
    handler: async ({ filePath, patch, reverse }: { filePath: string; patch: string; reverse?: boolean }, ctx: ToolContext) => {
      const pathCheck = getSecurityLayer().checkPath(filePath)
      if (!pathCheck.allowed) {
        return { success: false, error: pathCheck.reason ?? '路径被安全策略阻止' }
      }
      try {
        const absPath = resolve(filePath)
        if (!existsSync(absPath)) return { success: false, error: `文件不存在: ${absPath}` }
        const patchFile = join(ctx.cwd ?? process.cwd(), '.tmp_patch.tmp')
        await writeFile(patchFile, patch, 'utf-8')
        const args = ['apply', reverse ? '-R' : '', patchFile]
        try {
          const { stdout, stderr } = await execFileAsync('git', args.filter(Boolean), { cwd: dirname(absPath), timeout: 15_000 })
          await unlink(patchFile).catch(() => {})
          return { success: true, output: stdout || stderr || '补丁应用成功' }
        } catch {
          await unlink(patchFile).catch(() => {})
        }
        try {
          const operations = JSON.parse(patch)
          let content = await readFile(absPath, 'utf-8')
          for (const op of operations) {
            if (op.op === 'replace' && op.path && op.value !== undefined) {
              content = content.replace(op.path, op.value)
            }
          }
          await writeFile(absPath, content, 'utf-8')
          return { success: true, output: 'JSON 补丁应用成功' }
        } catch { /* 不是有效的 JSON Patch，继续尝试其他格式 */ }
        return { success: false, error: '补丁格式不支持。请使用 unified diff (git diff 输出) 或 JSON Patch 格式。' }
      } catch (e) {
        return { success: false, error: `补丁应用失败: ${e instanceof Error ? e.message : String(e)}` }
      }
    },
  })
}

export function registerPatchTools(registry: ToolRegistry): void {
  registerApplyPatch(registry)
}
