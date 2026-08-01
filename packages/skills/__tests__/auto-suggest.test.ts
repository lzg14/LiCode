import { describe, it, expect } from 'vitest'
import { matchSkills } from '../auto-suggest'
import type { SkillIndex } from '../types'

const mockSkills: SkillIndex[] = [
  {
    name: 'tdd',
    description: '测试驱动开发',
    triggerHints: '实现新功能；修 bug 后写 regression test'
  },
  {
    name: 'debugging',
    description: '调试难缠的 bug',
    triggerHints: '调试；debug；bug'
  },
  {
    name: 'planning',
    description: '多步任务实施计划',
    triggerHints: '复杂任务；多步骤'
  }
]

describe('matchSkills', () => {
  it('应该匹配测试相关输入到 tdd', () => {
    const result = matchSkills('帮我写测试', mockSkills)
    expect(result.some(s => s.name === 'tdd')).toBe(true)
  })

  it('应该匹配调试相关输入到 debugging', () => {
    const result = matchSkills('这个 bug 怎么调试', mockSkills)
    expect(result.some(s => s.name === 'debugging')).toBe(true)
  })

  it('应该匹配复杂任务到 planning', () => {
    const result = matchSkills('这个复杂任务需要计划', mockSkills)
    expect(result.some(s => s.name === 'planning')).toBe(true)
  })

  it('空输入应该返回空数组', () => {
    const result = matchSkills('', mockSkills)
    expect(result).toHaveLength(0)
  })

  it('不相关输入应该返回空数组', () => {
    const result = matchSkills('今天天气怎么样', mockSkills)
    expect(result).toHaveLength(0)
  })

  it('应该排除当前已激活的 skill', () => {
    const result = matchSkills('帮我写测试', mockSkills, 'tdd')
    expect(result.some(s => s.name === 'tdd')).toBe(false)
  })

  it('应该同时匹配多个 skill', () => {
    const result = matchSkills('帮我调试这个 bug 并写测试', mockSkills)
    expect(result.length).toBeGreaterThanOrEqual(2)
  })
})
