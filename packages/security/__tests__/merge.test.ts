import { describe, it, expect } from 'vitest'
import { mergeSecurityConfig, PLATFORM_DEFAULTS } from '../merge'

describe('mergeSecurityConfig', () => {
  it('无 user config → 用 default', () => {
    const r = mergeSecurityConfig(PLATFORM_DEFAULTS, undefined)
    expect(r.commandWhitelist).toEqual(PLATFORM_DEFAULTS.commandWhitelist)
  })

  it('user 加一个命令 → 默认 + 该命令', () => {
    const r = mergeSecurityConfig(PLATFORM_DEFAULTS, { commandWhitelist: ['my-cmd'] })
    expect(r.commandWhitelist).toContain('my-cmd')
    expect(r.commandWhitelist).toContain('git')  // 默认还在
  })

  it('user 加重复命令 → 去重', () => {
    const r = mergeSecurityConfig(PLATFORM_DEFAULTS, { commandWhitelist: ['git'] })
    const gitCount = r.commandWhitelist.filter(c => c === 'git').length
    expect(gitCount).toBe(1)
  })

  it('user 加空数组 → 不影响默认', () => {
    const r = mergeSecurityConfig(PLATFORM_DEFAULTS, { commandWhitelist: [] })
    expect(r.commandWhitelist).toEqual(PLATFORM_DEFAULTS.commandWhitelist)
  })

  it('user blockedCommands 追加', () => {
    const r = mergeSecurityConfig(
      PLATFORM_DEFAULTS,
      { blockedCommands: ['curl', 'wget'] }
    )
    expect(r.blockedCommands).toContain('rm')  // 默认黑名单
    expect(r.blockedCommands).toContain('sudo')  // 默认黑名单
    expect(r.blockedCommands).toContain('curl')  // 用户加的
  })

  it('user deniedPaths 追加（保守方向）', () => {
    const r = mergeSecurityConfig(PLATFORM_DEFAULTS, { deniedPaths: ['.ssh'] })
    expect(r.deniedPaths).toContain('.ssh')  // 用户加的
    // 默认路径也应保留
    expect(r.deniedPaths.length).toBeGreaterThanOrEqual(PLATFORM_DEFAULTS.deniedPaths.length)
  })

  it('user maxFileSize 覆盖默认', () => {
    const r = mergeSecurityConfig({ ...PLATFORM_DEFAULTS, maxFileSize: 1000 }, {})
    expect(r.maxFileSize).toBe(1000)
  })

  it('user maxFileSize 不传 → 用 default', () => {
    const r = mergeSecurityConfig(PLATFORM_DEFAULTS, {})
    expect(r.maxFileSize).toBe(PLATFORM_DEFAULTS.maxFileSize)
  })
})
