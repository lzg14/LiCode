import { describe, it, expect } from 'vitest'
import { SkillStack, inferSkillStack } from '../stack'
import type { SkillIndex } from '../types'

const mockSkills: SkillIndex[] = [
  { name: 'tdd', description: 'TDD', triggerHints: '' },
  { name: 'planning', description: '规划', triggerHints: '' },
  { name: 'debugging', description: '调试', triggerHints: '' }
]

describe('SkillStack', () => {
  it('应该正确 push 和获取 current', () => {
    const stack = new SkillStack()
    stack.push(mockSkills[0], 'primary', '## TDD 规则\n1. 先写测试')
    expect(stack.current()?.skill.name).toBe('tdd')
    expect(stack.current()?.instructions).toBe('## TDD 规则\n1. 先写测试')
  })

  it('应该正确 pop', () => {
    const stack = new SkillStack()
    stack.push(mockSkills[0])
    stack.push(mockSkills[1])
    const popped = stack.pop()
    expect(popped?.skill.name).toBe('planning')
    expect(stack.current()?.skill.name).toBe('tdd')
  })

  it('应该去重 push 同一个 skill', () => {
    const stack = new SkillStack()
    stack.push(mockSkills[0], 'primary', '旧 instructions')
    stack.push(mockSkills[0], 'secondary', '新 instructions')
    expect(stack.all()).toHaveLength(1)
    expect(stack.current()?.role).toBe('secondary')
    expect(stack.current()?.instructions).toBe('新 instructions')
  })

  it('isEmpty 应该正确判断', () => {
    const stack = new SkillStack()
    expect(stack.isEmpty()).toBe(true)
    stack.push(mockSkills[0])
    expect(stack.isEmpty()).toBe(false)
    stack.clear()
    expect(stack.isEmpty()).toBe(true)
  })

  it('toPromptString 应该包含 instructions', () => {
    const stack = new SkillStack()
    stack.push(mockSkills[0], 'primary', '## TDD 规则\n先写测试再写代码')
    stack.push(mockSkills[1], 'secondary', '## 规划规则\n分步执行')
    const result = stack.toPromptString()
    expect(result).toContain('当前激活技能栈')
    expect(result).toContain('tdd (主)')
    expect(result).toContain('## TDD 规则')
    expect(result).toContain('planning (辅)')
    expect(result).toContain('## 规划规则')
    expect(result).toContain('请严格遵循上述技能的指令与规则')
  })

  it('primary 应该返回第一个 primary skill', () => {
    const stack = new SkillStack()
    stack.push(mockSkills[0], 'secondary')
    stack.push(mockSkills[1], 'primary')
    expect(stack.primary()?.skill.name).toBe('planning')
  })

  it('remove 应该移除指定 skill', () => {
    const stack = new SkillStack()
    stack.push(mockSkills[0])
    stack.push(mockSkills[1])
    stack.remove('tdd')
    expect(stack.all()).toHaveLength(1)
    expect(stack.current()?.skill.name).toBe('planning')
  })
})

describe('inferSkillStack', () => {
  it('应该识别测试相关输入', () => {
    const result = inferSkillStack('帮我写测试')
    expect(result).toContain('tdd')
  })

  it('应该识别调试相关输入', () => {
    const result = inferSkillStack('这个 bug 需要调试')
    expect(result).toContain('debugging')
  })

  it('应该识别重构相关输入', () => {
    const result = inferSkillStack('重构这个模块')
    expect(result).toContain('planning')
  })

  it('应该识别多步骤任务', () => {
    const result = inferSkillStack('重构模块并写好测试')
    expect(result.length).toBeGreaterThanOrEqual(2)
  })

  it('空输入应该返回空数组', () => {
    const result = inferSkillStack('')
    expect(result).toHaveLength(0)
  })

  it('应该去重', () => {
    const result = inferSkillStack('测试测试测试')
    expect(new Set(result).size).toBe(result.length)
  })
})
