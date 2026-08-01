import { describe, it, expect, beforeAll } from 'vitest'
import { registerBuiltinTools } from '../builtin'
import { globalToolRegistry } from '../registry'

beforeAll(() => {
  registerBuiltinTools()
})

describe('stat tool', () => {
  it('获取文件信息', async () => {
    const result = await globalToolRegistry.execute('stat', { path: 'package.json' })
    expect(result.success).toBe(true)
    expect(result.output).toContain('size')
    expect(result.output).toContain('mtime')
  })

  it('获取不存在文件信息', async () => {
    const result = await globalToolRegistry.execute('stat', { path: 'nonexistent-file-12345.txt' })
    expect(result.success).toBe(false)
  })
})

describe('shell 工具安全', () => {
  it('危险 PowerShell 命令拦截: Invoke-Expression', async () => {
    const result = await globalToolRegistry.execute('bash', { command: 'Invoke-Expression "malicious"' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('安全')
  })

  it('危险 PowerShell 命令拦截: Set-ExecutionPolicy', async () => {
    const result = await globalToolRegistry.execute('bash', { command: 'Set-ExecutionPolicy Unrestricted' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('安全')
  })

  it('危险 PowerShell 命令拦截: Stop-Service', async () => {
    const result = await globalToolRegistry.execute('bash', { command: 'Stop-Service -Force' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('安全')
  })

  it('进程泄漏守卫: cmd /c start', async () => {
    const result = await globalToolRegistry.execute('bash', { command: 'cmd /c start notepad' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('禁止')
  })

  it('命令白名单拦截: schtasks', async () => {
    const result = await globalToolRegistry.execute('bash', { command: 'schtasks /create /tn test /tr notepad' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('安全拦截')
  })
})
