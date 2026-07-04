import { exec, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'
import type { ToolRegistry } from '../registry'
import type { ToolContext } from '../context'

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

function registerGitStatus(registry: ToolRegistry): void {
  registry.register({
    name: 'git_status',
    description: '获取 Git 状态。',
    inputSchema: z.object({ cwd: z.string().optional() }),
    handler: async ({ cwd }: { cwd?: string }, ctx: ToolContext) => {
      try { const { stdout } = await execAsync('git status --short', { cwd: cwd ?? ctx.cwd }); return { success: true, output: stdout || '工作区干净' } }
      catch (e) { return { success: false, error: String(e) } }
    },
  })
}

function registerGitDiff(registry: ToolRegistry): void {
  registry.register({
    name: 'git_diff',
    description: '获取 Git diff。',
    inputSchema: z.object({ cwd: z.string().optional(), file: z.string().optional(), staged: z.boolean().optional() }),
    handler: async ({ cwd, file, staged }: { cwd?: string; file?: string; staged?: boolean }, ctx: ToolContext) => {
      try {
        const args = staged ? ['diff', '--staged'] : ['diff']
        if (file) args.push('--', file)
        const { stdout } = await execFileAsync('git', args, { cwd: cwd ?? ctx.cwd })
        return { success: true, output: stdout || '无变更' }
      } catch (e) { return { success: false, error: String(e) } }
    },
  })
}

function registerGitLog(registry: ToolRegistry): void {
  registry.register({
    name: 'git_log',
    description: '获取 Git 日志。',
    inputSchema: z.object({ cwd: z.string().optional(), count: z.number().default(10) }),
    handler: async ({ cwd, count }: { cwd?: string; count: number }, ctx: ToolContext) => {
      try {
        const { stdout } = await execFileAsync('git', ['log', '--oneline', '-n', String(count)], { cwd: cwd ?? ctx.cwd })
        return { success: true, output: stdout || '无记录' }
      } catch (e) { return { success: false, error: String(e) } }
    },
  })
}

function registerGitCommit(registry: ToolRegistry): void {
  registry.register({
    name: 'git_commit',
    description: 'Git 提交。',
    inputSchema: z.object({ message: z.string(), cwd: z.string().optional(), files: z.array(z.string()).optional() }),
    handler: async ({ message, cwd, files }: { message: string; cwd?: string; files?: string[] }, ctx: ToolContext) => {
      try {
        if (files?.length) {
          await execFileAsync('git', ['add', ...files], { cwd: cwd ?? ctx.cwd })
        } else {
          await execFileAsync('git', ['add', '-A'], { cwd: cwd ?? ctx.cwd })
        }
        const { stdout } = await execFileAsync('git', ['commit', '-m', message], { cwd: cwd ?? ctx.cwd })
        return { success: true, output: stdout }
      } catch (e) { return { success: false, error: String(e) } }
    },
  })
}

export function registerGitTools(registry: ToolRegistry): void {
  registerGitStatus(registry)
  registerGitDiff(registry)
  registerGitLog(registry)
  registerGitCommit(registry)
}
