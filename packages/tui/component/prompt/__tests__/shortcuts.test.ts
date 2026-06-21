import { describe, it, expect } from 'vitest'

// 测试剪贴板工具
describe('clipboard', () => {
  it('copyToClipboard is a function', async () => {
    const { copyToClipboard } = await import('../../../util/clipboard')
    expect(typeof copyToClipboard).toBe('function')
  })

  it('readFromClipboard is a function', async () => {
    const { readFromClipboard } = await import('../../../util/clipboard')
    expect(typeof readFromClipboard).toBe('function')
  })
})

// 测试 Prompt 快捷键逻辑（需要 mock opentui）
describe('Prompt shortcuts', () => {
  // 注意：完整测试需要 mock TextareaRenderable
  // 这里只测试基本的类型导出
  it('exports Prompt component', async () => {
    const mod = await import('../index')
    expect(typeof mod.Prompt).toBe('function')
  })

  it('exports focusInput', async () => {
    const mod = await import('../index')
    expect(typeof mod.focusInput).toBe('function')
  })

  it('exports setPromptText', async () => {
    const mod = await import('../index')
    expect(typeof mod.setPromptText).toBe('function')
  })

  it('exports prependPromptText', async () => {
    const mod = await import('../index')
    expect(typeof mod.prependPromptText).toBe('function')
  })
})
