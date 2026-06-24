/**
 * 回归测试:确保 bunx 始终在默认白名单中。
 *
 * 背景:CLAUDE.md 推荐用 `bunx tsc --noEmit --skipLibCheck` 做类型检查,
 *      但 v0.3.0 时遗漏添加,导致 agent 跑类型检查被自己拦截。
 *      这个测试保证以后不会再漏。
 */
import { describe, it, expect } from 'vitest'
import { getDefaultWhitelist, isCommandAllowed } from '../whitelist'

describe('whitelist: bunx regression', () => {
  it('should include bunx in default whitelist', () => {
    expect(getDefaultWhitelist()).toContain('bunx')
  })

  it('should allow bunx commands', () => {
    expect(isCommandAllowed('bunx tsc --noEmit --skipLibCheck')).toBe(true)
    expect(isCommandAllowed('bunx vitest run')).toBe(true)
  })

  it('should be platform-agnostic (no win32/linux only constraint)', () => {
    // bunx 在所有平台都该有
    expect(getDefaultWhitelist('win32')).toContain('bunx')
    expect(getDefaultWhitelist('linux')).toContain('bunx')
    expect(getDefaultWhitelist('darwin')).toContain('bunx')
  })
})
