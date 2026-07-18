/**
 * 提权命令执行工具
 *
 * 设计目的：
 *   解决 bash 工具在 Windows 上执行 `Start-Process -Verb RunAs` 时的进程泄漏问题。
 *   原 bash 工具用 child_process.exec，启动 UAC 提权后子进程脱离 cmd.exe 进程树，
 *   exec 立即返回但 powershell.exe 仍驻留内存（每个 2-3 GB）。
 *
 * 工作原理：
 *   用 bun.spawn 直接 fork powershell.exe，通过 task.exited Promise 等待真正的子进程退出。
 *   这避免了 child_process.exec + UAC + ShellExecuteEx 三层抽象导致的进程脱离。
 */

import { z } from 'zod'
import type { ToolRegistry } from '../registry'
import type { ToolContext } from '../context'

const inputSchema = z.object({
  command: z.string().describe('要在管理员权限下执行的 PowerShell 命令（不需要 -Command 前缀）'),
  cwd: z.string().optional().describe('工作目录'),
  timeout: z.number().optional().describe('超时毫秒数，默认 60000'),
})

/**
 * 检测是否是危险命令（与 security/index.ts 的 DANGEROUS_PATTERNS 保持一致）
 * 在提权场景下危险更大，所以额外严格
 */
const ELEVATED_BLOCKED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /Remove-Item\s+(-Recurse|-Force|-rf)\b.*[A-Z]:\\/i, reason: '禁止提权删除驱动器根目录' },
  { pattern: /Format-Volume\b/i, reason: '禁止提权格式化磁盘' },
  { pattern: /Stop-Service\s+-Force\s+(VBoxSDS|w32time|RPCSS|Themes)\b/i, reason: '禁止提权强制停止关键服务' },
  { pattern: /Remove-ItemRecurse.*System32/i, reason: '禁止提权删除系统目录' },
  { pattern: /Set-ExecutionPolicy\s+Unrestricted/i, reason: '禁止提权修改执行策略' },
  { pattern: /Clear-RecycleBin\s+-Force/i, reason: '禁止提权清空回收站' },
  { pattern: /New-ItemProperty.*HKLM:\\.*\\CurrentControlSet\\Services.*-Force/i, reason: '禁止提权强制修改系统服务注册表' },
]

export function registerElevatedTools(registry: ToolRegistry): void {
  registry.register({
    name: 'elevated_bash',
    description: '执行需要管理员权限的 PowerShell 命令。使用 bun.spawn 直接等待子进程退出，' +
      '避免 Start-Process -Verb RunAs 导致的 powershell.exe 进程泄漏。' +
      '仅在确实需要 UAC 提权时使用；优先用普通 bash 工具。',
    inputSchema,
    maxOutputTokens: 50_000,
    handler: async (
      { command, cwd, timeout }: { command: string; cwd?: string; timeout?: number },
      ctx: ToolContext,
    ) => {
      // 1. 危险命令检查
      for (const { pattern, reason } of ELEVATED_BLOCKED_PATTERNS) {
        if (pattern.test(command)) {
          return { success: false, error: `提权命令被安全策略阻止: ${reason}` }
        }
      }

      // 2. 用 bun.spawn 直接 fork powershell.exe
      //    关键：不走 ShellExecuteEx / Start-Process，避免 UAC 后的进程脱离
      const timeoutMs = timeout ?? 60_000
      const effectiveCwd = cwd ?? ctx.cwd

      // 转义命令：把 " 包成 \"
      const escaped = command.replace(/"/g, '\\"')

      let proc: ReturnType<typeof Bun.spawn> | undefined
      try {
        proc = Bun.spawn({
          cmd: ['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', escaped],
          cwd: effectiveCwd,
          env: { ...process.env },
          stdout: 'pipe',
          stderr: 'pipe',
        })
      } catch (e) {
        return { success: false, error: `提权进程启动失败: ${e instanceof Error ? e.message : String(e)}` }
      }

      // 3. 关键：同时等待 stdout/stderr/exit，任何一个超时都 kill 进程
      let timer: ReturnType<typeof setTimeout> | undefined
      const stdoutPromise = new Response(proc.stdout as ReadableStream).text()
      const stderrPromise = new Response(proc.stderr as ReadableStream).text()

      try {
        const exitCode = await Promise.race([
          proc.exited,
          new Promise<'timeout'>((resolve) => {
            timer = setTimeout(() => resolve('timeout'), timeoutMs)
          }),
        ])

        if (timer) clearTimeout(timer)

        if (exitCode === 'timeout') {
          proc.kill()
          // 等待子进程被真正杀掉（最多 5 秒）
          await Promise.race([
            proc.exited,
            new Promise<'kill-timeout'>((resolve) => setTimeout(() => resolve('kill-timeout'), 5_000)),
          ])
          return {
            success: false,
            error: `提权命令超时（${timeoutMs}ms），已强制结束 powershell.exe 进程（PID ${proc.pid}）`,
          }
        }

        const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise])
        const output = (stdout || stderr || '完成').trim()
        return {
          success: exitCode === 0,
          output: output || (exitCode === 0 ? '完成（无输出）' : `退出码 ${exitCode}（无输出）`),
          ...(exitCode !== 0 && { error: stderr || `Exit code: ${exitCode}` }),
        }
      } catch (e) {
        // 兜底：确保进程被 kill
        try { proc.kill() } catch {}
        return { success: false, error: `提权命令执行异常: ${e instanceof Error ? e.message : String(e)}` }
      } finally {
        // 终极保险：再 kill 一次（幂等）
        try { proc.kill() } catch {}
      }
    },
  })
}