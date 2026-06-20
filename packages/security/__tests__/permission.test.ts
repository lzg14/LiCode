import { describe, it, expect } from 'vitest'
import { PermissionManager, PERMISSION_PRESETS, createPermissionManager, mergePermissions } from '../permission'

describe('PermissionManager', () => {
  it('should check default allow', () => {
    const manager = new PermissionManager()
    const result = manager.check({ tool: 'read' })
    expect(result.allowed).toBe(true)
    expect(result.action).toBe('allow')
  })

  it('should check default ask', () => {
    const manager = new PermissionManager()
    const result = manager.check({ tool: 'delete_file' })
    expect(result.allowed).toBe(false)
    expect(result.action).toBe('ask')
  })

  it('should load config overrides', () => {
    const manager = new PermissionManager({ read: 'deny' })
    const result = manager.check({ tool: 'read' })
    expect(result.allowed).toBe(false)
    expect(result.action).toBe('deny')
  })

  it('should add and check rules', () => {
    const manager = new PermissionManager()
    manager.addRule({ tool: 'bash', pattern: 'rm -rf', action: 'deny', reason: '危险命令' })

    const result = manager.check({ tool: 'bash', args: { command: 'rm -rf /' } })
    expect(result.allowed).toBe(false)
    expect(result.action).toBe('deny')
    expect(result.reason).toBe('危险命令')
  })

  it('should merge managers', () => {
    const base = new PermissionManager()
    const custom = new PermissionManager({ read: 'ask' })

    base.merge(custom)
    const result = base.check({ tool: 'read' })
    expect(result.action).toBe('ask')
  })

  it('should remove rules', () => {
    const manager = new PermissionManager()
    manager.addRule({ tool: 'bash', pattern: 'rm', action: 'deny' })
    manager.addRule({ tool: 'bash', pattern: 'sudo', action: 'deny' })

    manager.removeRule('bash', 'rm')
    const rules = manager.getRules()
    expect(rules.length).toBe(1)
    expect(rules[0].pattern).toBe('sudo')
  })

  it('should export config', () => {
    const manager = new PermissionManager()
    manager.addRule({ tool: 'bash', action: 'ask' })

    const config = manager.exportConfig()
    expect(config.read).toBe('allow')
    expect(config.delete_file).toBe('ask')
  })

  it('should use createPermissionManager helper', () => {
    const manager = createPermissionManager('explore')
    const readResult = manager.check({ tool: 'read' })
    expect(readResult.allowed).toBe(true)

    const writeResult = manager.check({ tool: 'write' })
    // write 默认是 allow，explore 没有覆盖它
    expect(writeResult.allowed).toBe(true)
  })

  it('should merge permission configs', () => {
    const config1 = { read: 'allow', write: 'ask' }
    const config2 = { write: 'allow', delete_file: 'deny' }

    const merged = mergePermissions(config1, config2)
    expect(merged.read).toBe('allow')
    expect(merged.write).toBe('allow')
    expect(merged.delete_file).toBe('deny')
  })
})

describe('PERMISSION_PRESETS', () => {
  it('should have primary preset', () => {
    expect(PERMISSION_PRESETS.primary.question).toBe('allow')
    expect(PERMISSION_PRESETS.primary.plan_enter).toBe('allow')
  })

  it('should have plan preset', () => {
    expect(PERMISSION_PRESETS.plan['*']).toBe('deny')
    expect(PERMISSION_PRESETS.plan.read).toBe('allow')
  })

  it('should have explore preset', () => {
    expect(PERMISSION_PRESETS.explore['*']).toBe('deny')
    expect(PERMISSION_PRESETS.explore.read).toBe('allow')
    expect(PERMISSION_PRESETS.explore.grep).toBe('allow')
  })

  it('should have minimal preset', () => {
    expect(PERMISSION_PRESETS.minimal['*']).toBe('deny')
    expect(PERMISSION_PRESETS.minimal.read).toBe('allow')
  })
})
