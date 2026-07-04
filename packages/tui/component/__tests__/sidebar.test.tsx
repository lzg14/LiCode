import { describe, expect, it } from 'vitest'

// SolidJS + opentui 组件在无渲染上下文时部分导出为 undefined
// 这里测试模块可加载 + 已知可导出的组件

describe('Sidebar component', () => {
  it('exports Sidebar component', async () => {
    const mod = await import('../sidebar')
    expect(typeof mod.Sidebar).toBe('function')
  })
})

describe('MessageList component', () => {
  it('exports MessageList component', async () => {
    const mod = await import('../message-list')
    expect(typeof mod.MessageList).toBe('function')
  })
})

describe('CollapsibleText component', () => {
  it('exports CollapsibleText component', async () => {
    const mod = await import('../collapsible-text')
    expect(typeof mod.CollapsibleText).toBe('function')
  })
})

describe('Spinner component', () => {
  it('exports Spinner component', async () => {
    const mod = await import('../spinner')
    expect(typeof mod.Spinner).toBe('function')
  })
})

describe('ThinkingView component', () => {
  it('exports ThinkingView component', async () => {
    const mod = await import('../thinking-view')
    expect(typeof mod.ThinkingView).toBe('function')
  })
})

describe('Logo component', () => {
  it('exports Logo component', async () => {
    const mod = await import('../logo')
    expect(typeof mod.Logo).toBe('function')
  })
})
