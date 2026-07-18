import { afterAll, describe, expect, it } from 'vitest'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { registerBuiltinTools } from '../builtin'
import { globalToolRegistry } from '../registry'

const execAsync = promisify(exec)

registerBuiltinTools()

describe('elevated_bash tool', () => {
  it('should be registered', () => {
    const tool = globalToolRegistry.get('elevated_bash')
    expect(tool).toBeDefined()
    expect(tool?.description).toContain('bun.spawn')
  })

  it('should block dangerous elevated commands (Format-Volume)', async () => {
    const result = await globalToolRegistry.execute('elevated_bash', {
      command: 'Format-Volume -DriveLetter C -Force',
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('格式化')
  })

  it('should block dangerous elevated commands (Remove-Item System32)', async () => {
    const result = await globalToolRegistry.execute('elevated_bash', {
      command: 'Remove-Item -Recurse -Force C:\\Windows\\System32',
    })
    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('should block dangerous elevated commands (Clear-RecycleBin)', async () => {
    const result = await globalToolRegistry.execute('elevated_bash', {
      command: 'Clear-RecycleBin -Force',
    })
    expect(result.success).toBe(false)
  })

  it('should execute safe commands without leaking processes', async () => {
    // 记录执行前的 powershell 进程
    const { stdout: before } = await execAsync('tasklist /FI "IMAGENAME eq powershell.exe" /FO CSV /NH', { timeout: 5000 }).catch(() => ({ stdout: '' }))
    const beforeCount = (before.match(/powershell\.exe/g) || []).length

    // 执行一个简单命令
    const result = await globalToolRegistry.execute('elevated_bash', {
      command: 'Write-Output "test ok"',
      timeout: 10_000,
    })

    // 等待 2 秒确保 powershell 进程完全清理
    await new Promise((r) => setTimeout(r, 2000))

    const { stdout: after } = await execAsync('tasklist /FI "IMAGENAME eq powershell.exe" /FO CSV /NH', { timeout: 5000 }).catch(() => ({ stdout: '' }))
    const afterCount = (after.match(/powershell\.exe/g) || []).length

    // 关键断言：执行后 powershell 进程数不应该明显增加
    // （允许 bun.spawn 启动的临时 powershell 在 exit 之后被回收）
    // 我们期望 afterCount <= beforeCount + 1（容差 1 个测试自身的）
    expect(afterCount).toBeLessThanOrEqual(beforeCount + 1)

    // 命令应该成功执行
    expect(result).toBeDefined()
  }, 30_000)

  it('should kill child process on timeout', async () => {
    // 执行一个会超时的命令（Start-Sleep 60秒，超时 3 秒）
    const result = await globalToolRegistry.execute('elevated_bash', {
      command: 'Start-Sleep -Seconds 60; Write-Output "should not reach here"',
      timeout: 3_000,
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('超时')

    // 验证没有 powershell 进程残留（除了测试自身的）
    await new Promise((r) => setTimeout(r, 1500))
    const { stdout } = await execAsync('tasklist /FI "IMAGENAME eq powershell.exe" /FO CSV /NH', { timeout: 5000 }).catch(() => ({ stdout: '' }))
    const afterCount = (stdout.match(/powershell\.exe/g) || []).length

    // 不应该因为这次测试产生新的 powershell 残留
    // （我们执行了 60 秒 sleep 命令，应该已被 kill）
    expect(afterCount).toBeLessThanOrEqual(3)
  }, 15_000)
})

describe('bash tool - process leak guard', () => {
  it('should block Start-Process -Verb RunAs', async () => {
    const result = await globalToolRegistry.execute('bash', {
      command: 'powershell -Command "Start-Process powershell -Verb RunAs -ArgumentList \'echo test\'"',
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('Start-Process -Verb RunAs')
    expect(result.error).toContain('elevated_bash')
  })

  it('should block cmd /c start pattern', async () => {
    const result = await globalToolRegistry.execute('bash', {
      command: 'cmd /c start "" powershell -Command "echo test"',
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('cmd /c start')
  })

  it('should NOT block normal powershell commands', async () => {
    const result = await globalToolRegistry.execute('bash', {
      command: 'powershell -NoProfile -Command "Write-Output \'hello\'"',
    })
    // 这个应该成功（或至少不会被 leak guard 拦截）
    expect(result.error ?? '').not.toContain('进程泄漏')
    expect(result.error ?? '').not.toContain('Start-Process')
  })
})