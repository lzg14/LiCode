import { exec, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'
import type { ToolRegistry } from '../registry'
import type { ToolContext } from '../context'

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

function registerRunTests(registry: ToolRegistry): void {
  registry.register({
    name: 'run_tests',
    description: '运行项目测试。',
    inputSchema: z.object({ cwd: z.string().optional() }),
    handler: async ({ cwd }: { cwd?: string }, ctx: ToolContext) => {
      try { const { stdout, stderr } = await execAsync('bun test 2>&1 || npx vitest run 2>&1', { cwd: cwd ?? ctx.cwd, timeout: 60_000 }); return { success: true, output: stdout || stderr || '完成' } }
      catch (e) { return { success: false, error: String(e) } }
    },
  })
}

function registerInstallDeps(registry: ToolRegistry): void {
  registry.register({
    name: 'install_deps',
    description: '安装依赖。',
    inputSchema: z.object({ cwd: z.string().optional(), package: z.string().optional(), dev: z.boolean().optional() }),
    handler: async ({ cwd, package: pkg, dev }: { cwd?: string; package?: string; dev?: boolean }, ctx: ToolContext) => {
      try {
        const args = pkg ? ['add', ...(dev ? ['-D'] : []), pkg] : ['install']
        const { stdout, stderr } = await execFileAsync('bun', args, { cwd: cwd ?? ctx.cwd, timeout: 120_000 })
        return { success: true, output: stdout || stderr || '完成' }
      } catch (e) { return { success: false, error: String(e) } }
    },
  })
}

function registerFormat(registry: ToolRegistry): void {
  registry.register({
    name: 'format',
    description: '格式化代码。自动检测项目配置（prettier / dprint / biome），回退到通用格式化。',
    inputSchema: z.object({
      path: z.string().describe('要格式化的文件或目录路径'),
      cwd: z.string().optional().describe('工作目录'),
      check: z.boolean().optional().describe('仅检查是否已格式化，不修改文件'),
    }),
    handler: async ({ path, cwd, check }: { path: string; cwd?: string; check?: boolean }, ctx: ToolContext) => {
      const workDir = cwd ?? ctx.cwd
      const tryRun = async (cmd: string): Promise<string | null> => {
        try {
          const { stdout, stderr } = await execAsync(cmd, { cwd: workDir, timeout: 30_000 })
          return (stdout || stderr || '').trim()
        } catch { return null }
      }
      const flag = check ? '--check' : '--write'
      const cmds = [
        `bun run format ${flag} "${path}" 2>&1`,
        `npx prettier ${flag} "${path}" 2>&1`,
        `npx dprint ${flag} "${path}" 2>&1`,
        `bun x @biomejs/biome format ${flag} "${path}" 2>&1`,
      ]
      for (const c of cmds) {
        const out = await tryRun(c)
        if (out !== null) return { success: true, output: out || '格式化完成' }
      }
      return { success: true, output: '未找到格式化工具，请先配置 prettier/dprint/biome' }
    },
  })
}

function registerLint(registry: ToolRegistry): void {
  registry.register({
    name: 'lint',
    description: '运行代码检查。自动检测项目配置（eslint / ruff / biome），回退到 tsconfig 检查。',
    inputSchema: z.object({
      path: z.string().optional().describe('要检查的文件或目录路径'),
      cwd: z.string().optional().describe('工作目录'),
      fix: z.boolean().optional().describe('是否自动修复问题'),
    }),
    handler: async ({ path, cwd, fix }: { path?: string; cwd?: string; fix?: boolean }, ctx: ToolContext) => {
      const workDir = cwd ?? ctx.cwd
      const tryRun = async (cmd: string): Promise<string | null> => {
        try {
          const { stdout, stderr } = await execAsync(cmd, { cwd: workDir, timeout: 60_000 })
          return (stdout || stderr || '').trim()
        } catch (e) {
          const err = e as Record<string, string | undefined>
          return err.stdout || err.stderr || (e instanceof Error ? e.message : String(e))
        }
      }
      const fixFlag = fix ? '--fix' : ''
      const cmds = [
        `npx tsc --noEmit --skipLibCheck 2>&1`,
        `npx eslint ${fixFlag} "${path ?? '.'}" 2>&1`,
        `bunx eslint ${fixFlag} "${path ?? '.'}" 2>&1`,
        `ruff check ${fixFlag} ${path ?? '.'} 2>&1`,
        `npx @biomejs/biome lint ${fixFlag} "${path ?? '.'}" 2>&1`,
      ]
      for (const cmd of cmds) {
        const out = await tryRun(cmd)
        if (out) return { success: true, output: out }
      }
      return { success: true, output: '未发现问题' }
    },
  })
}

export function registerDevTools(registry: ToolRegistry): void {
  registerRunTests(registry)
  registerInstallDeps(registry)
  registerFormat(registry)
  registerLint(registry)
}
