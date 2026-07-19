import { exec, execFile } from 'node:child_process'
import { stat as fsStat } from 'node:fs/promises'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { z } from 'zod'
import { getSecurityLayer } from '../../security'
import type { ToolRegistry } from '../registry'
import type { ToolContext } from '../context'

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

/**
 * 进程泄漏守卫：检测会导致子进程脱离进程树的命令模式
 *
 * 这些模式会导致 child_process.exec 立即返回，但实际子进程在后台驻留内存：
 *   - Start-Process -Verb RunAs (UAC 提权后子进程由 explorer.exe 接管)
 *   - cmd /c start "" (后台启动脱离 cmd.exe 子进程树)
 *   - schtasks /create /tn xxx /tr ... (计划任务立即返回，但任务进程后台跑)
 */
const PROCESS_LEAK_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /Start-Process\s+[^|]*-Verb\s+RunAs/i,
    reason: '禁止 bash 工具用 Start-Process -Verb RunAs 提权（子进程会脱离进程树，导致 powershell.exe 泄漏）。请改用 elevated_bash 工具。',
  },
  {
    pattern: /\bcmd\s+\/c\s+start\s+/i,
    reason: '禁止 bash 工具用 cmd /c start 后台启动（子进程会脱离 cmd.exe 进程树）。如需后台进程，请用 elevated_bash。',
  },
  {
    pattern: /\bschtasks\s+\/create\b/i,
    reason: '禁止 bash 工具用 schtasks /create（计划任务进程不在 bash 工具跟踪范围内）。',
  },
]

function checkProcessLeak(command: string): { leak: boolean; reason?: string } {
  for (const { pattern, reason } of PROCESS_LEAK_PATTERNS) {
    if (pattern.test(command)) {
      return { leak: true, reason }
    }
  }
  return { leak: false }
}

function registerBash(registry: ToolRegistry): void {
  registry.register({
    name: 'bash',
    description: '执行 shell 命令。',
    inputSchema: z.object({ command: z.string(), cwd: z.string().optional(), timeout: z.number().optional() }),
    handler: async ({ command, cwd, timeout }: { command: string; cwd?: string; timeout?: number }, ctx: ToolContext) => {
      // 进程泄漏守卫
      const leakCheck = checkProcessLeak(command)
      if (leakCheck.leak) {
        return { success: false, error: leakCheck.reason ?? '命令可能造成进程泄漏，已拒绝' }
      }

      const cmdCheck = getSecurityLayer().checkCommand(command)
      if (!cmdCheck.allowed) {
        return { success: false, error: cmdCheck.reason ?? '命令被安全策略阻止' }
      }
      try {
        const { stdout, stderr } = await execAsync(command, { cwd: cwd ?? ctx.cwd, timeout: timeout ?? 30_000, maxBuffer: 10 * 1024 * 1024 })
        return { success: true, output: stdout || stderr || '完成' }
      } catch (e) { return { success: false, error: e instanceof Error ? e.message : String(e) } }
    },
  })
}

function registerStat(registry: ToolRegistry): void {
  registry.register({
    name: 'stat',
    description: '获取文件详细信息。',
    inputSchema: z.object({ path: z.string() }),
    handler: async ({ path }: { path: string }) => {
      try {
        const info = await fsStat(path)
        return { success: true, output: JSON.stringify({ size: info.size, sizeKB: `${(info.size / 1024).toFixed(2)} KB`, mtime: info.mtime.toISOString(), isFile: info.isFile(), isDirectory: info.isDirectory() }, null, 2) }
      } catch (e) { return { success: false, error: String(e) } }
    },
  })
}

function registerEnvVars(registry: ToolRegistry): void {
  // 统一敏感变量检测规则：单 key 模式和列出模式都用同一份，避免漏过
  const SENSITIVE_PATTERNS = [/api_?key/i, /token/i, /secret/i, /password/i, /credential/i, /^auth(_|$)/i]

  function isSensitive(name: string): boolean {
    return SENSITIVE_PATTERNS.some(p => p.test(name))
  }

  registry.register({
    name: 'env_vars',
    description: '获取环境变量。敏感变量（key/token/secret/password 等）会被拒绝读取。',
    inputSchema: z.object({ name: z.string().optional() }),
    handler: async ({ name }: { name?: string }) => {
      if (name) {
        // 单 key 模式：和列出模式用同一份敏感规则，防止 LLM 用任意 key 名读凭据
        if (isSensitive(name)) {
          return { success: false, error: `禁止读取敏感环境变量: ${name}` }
        }
        return { success: true, output: process.env[name] ?? `${name} 不存在` }
      }
      const filtered = Object.entries(process.env)
        .filter(([k]) => !isSensitive(k))
        .map(([k, v]) => `${k}=${v}`)
        .join('\n')
      return { success: true, output: filtered || '无环境变量' }
    },
  })
}

function registerDatetime(registry: ToolRegistry): void {
  registry.register({
    name: 'datetime',
    description: '获取当前日期时间。支持简单格式化（YYYY/MM/DD/HH/mm/ss）。',
    inputSchema: z.object({
      format: z.string().optional().describe('格式化字符串'),
    }),
    handler: async ({ format }: { format?: string }) => {
      const now = new Date()
      if (!format) return { success: true, output: now.toISOString() }
      const tokens: Record<string, string> = {
        YYYY: String(now.getFullYear()),
        MM: String(now.getMonth() + 1).padStart(2, '0'),
        DD: String(now.getDate()).padStart(2, '0'),
        HH: String(now.getHours()).padStart(2, '0'),
        mm: String(now.getMinutes()).padStart(2, '0'),
        ss: String(now.getSeconds()).padStart(2, '0'),
      }
      let out = format
      for (const [k, v] of Object.entries(tokens)) out = out.replace(new RegExp(k, 'g'), v)
      return { success: true, output: out }
    },
  })
}

function registerSystemInfo(registry: ToolRegistry): void {
  registry.register({
    name: 'system_info',
    description: '获取系统信息。',
    inputSchema: z.object({}),
    handler: async () => {
      return { success: true, output: JSON.stringify({ platform: process.platform, arch: process.arch, node: process.version, cwd: process.cwd(), mem: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB` }, null, 2) }
    },
  })
}

function registerProcessList(registry: ToolRegistry): void {
  registry.register({
    name: 'process_list',
    description: '列出运行中的进程（Windows tasklist）。支持按名称过滤。',
    inputSchema: z.object({
      filter: z.string().optional().describe('进程名过滤（如 "node", "code"）'),
      limit: z.number().optional().describe('最多显示行数，默认50'),
    }),
    handler: async ({ filter, limit }: { filter?: string; limit?: number }) => {
      try {
        const args = filter
          ? ['tasklist', '/FI', `IMAGENAME eq ${filter}*`, '/FO', 'CSV', '/NH']
          : ['tasklist', '/FO', 'CSV', '/NH']
        const { stdout } = await execFileAsync('tasklist', args, { timeout: 10000 })
        const lines = stdout.trim().split('\n').filter(Boolean)
        const result = limit ? lines.slice(0, limit) : lines.slice(0, 50)
        return { success: true, output: result.join('\n') || '无匹配进程' }
      } catch (e) { return { success: false, error: String(e) } }
    },
  })
}

function registerKillProcess(registry: ToolRegistry): void {
  registry.register({
    name: 'kill_process',
    description: '结束指定进程（Windows taskkill）。',
    inputSchema: z.object({
      pid: z.number().describe('进程 ID'),
      force: z.boolean().optional().describe('强制结束，默认false'),
    }),
    handler: async ({ pid, force }: { pid: number; force?: boolean }) => {
      try {
        const flag = force ? '/F' : ''
        const { stdout } = await execAsync(`taskkill ${flag} /PID ${pid}`, { timeout: 5000 })
        return { success: true, output: stdout || `进程 ${pid} 已结束` }
      } catch (e) { return { success: false, error: String(e) } }
    },
  })
}

function registerOpenExplorer(registry: ToolRegistry): void {
  registry.register({
    name: 'open_explorer',
    description: '在 Windows 资源管理器中打开指定路径。',
    inputSchema: z.object({
      path: z.string().describe('文件或目录路径'),
      select: z.boolean().optional().describe('是否选中文件'),
    }),
    handler: async ({ path, select }: { path: string; select?: boolean }) => {
      try {
        const absPath = resolve(path)
        const args = select ? ['/select,', absPath] : [absPath]
        await execFileAsync('explorer', args, { timeout: 3000 })
        return { success: true, output: `已在资源管理器中打开: ${absPath}` }
      } catch (e) { return { success: false, error: String(e) } }
    },
  })
}

function registerOpenUrl(registry: ToolRegistry): void {
  registry.register({
    name: 'open_url',
    description: '在默认浏览器中打开 URL。',
    inputSchema: z.object({
      url: z.string().describe('URL 地址'),
    }),
    handler: async ({ url }: { url: string }) => {
      try {
        if (process.platform === 'win32') {
          await execFileAsync('cmd.exe', ['/c', 'start', '', url], { timeout: 3000 })
        } else {
          await execFileAsync('open', [url], { timeout: 3000 })
        }
        return { success: true, output: `已在浏览器中打开: ${url}` }
      } catch (e) { return { success: false, error: String(e) } }
    },
  })
}

function registerGh(registry: ToolRegistry): void {
  registry.register({
    name: 'gh',
    description: '执行 GitHub CLI (gh) 命令。自动在 git root 目录执行。用途：查看 PR/issue、创建 PR、查看 repo 信息等。',
    inputSchema: z.object({
      args: z.string().describe('gh 命令参数，如 "pr list --state open --limit 10"'),
      timeout: z.number().optional().describe('超时秒数，默认30秒'),
    }),
    handler: async ({ args, timeout }: { args: string; timeout?: number }, ctx: ToolContext) => {
      try {
        const argsArray: string[] = []
        let current = ''
        let inQuote = false
        for (const char of args) {
          if (char === '"') {
            inQuote = !inQuote
          } else if (char === ' ' && !inQuote) {
            if (current) {
              argsArray.push(current)
              current = ''
            }
          } else {
            current += char
          }
        }
        if (current) argsArray.push(current)

        const { stdout, stderr } = await execFileAsync('gh', argsArray, { cwd: ctx.cwd, timeout: (timeout ?? 30) * 1000 })
        const output = stdout || stderr || '命令执行完成（无输出）'
        return { success: true, output }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (msg.includes('not found')) {
          return { success: false, error: 'gh.exe 未安装。请从 https://cli.github.com 安装 GitHub CLI。' }
        }
        return { success: false, error: msg }
      }
    },
  })
}

export function registerShellTools(registry: ToolRegistry): void {
  registerBash(registry)
  registerStat(registry)
  registerEnvVars(registry)
  registerDatetime(registry)
  registerSystemInfo(registry)
  registerProcessList(registry)
  registerKillProcess(registry)
  registerOpenExplorer(registry)
  registerOpenUrl(registry)
  registerGh(registry)
}
