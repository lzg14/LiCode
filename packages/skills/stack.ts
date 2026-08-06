import type { Skill, SkillIndex } from './types'

/**
 * Skill 栈管理 - 支持多 skill 同时激活
 * 某些场景需要多个 skill 协同：
 * 用户："重构这个模块，写好测试，准备 PR"
 * 需要：planning → tdd → verification → finishing-branch
 */

export interface SkillStackItem {
  skill: SkillIndex
  /** 主 skill 还是辅 skill */
  role: 'primary' | 'secondary'
  /** 激活时间 */
  activatedAt: number
  /** skill 的完整指令内容 */
  instructions: string
}

export class SkillStack {
  private stack: SkillStackItem[] = []

  /**
   * 压入新 skill
   */
  push(skill: SkillIndex, role: 'primary' | 'secondary' = 'primary', instructions: string = ''): void {
    // 检查是否已存在
    const existing = this.stack.find(s => s.skill.name === skill.name)
    if (existing) {
      // 更新 role 和 instructions
      existing.role = role
      if (instructions) existing.instructions = instructions
      return
    }
    this.stack.push({ skill, role, activatedAt: Date.now(), instructions })
  }

  /**
   * 弹出栈顶 skill
   */
  pop(): SkillStackItem | undefined {
    return this.stack.pop()
  }

  /**
   * 获取当前栈顶 skill（主 skill）
   */
  current(): SkillStackItem | undefined {
    return this.stack[this.stack.length - 1]
  }

  /**
   * 获取所有激活的 skill
   */
  all(): SkillStackItem[] {
    return [...this.stack]
  }

  /**
   * 获取主 skill（栈底第一个 primary）
   */
  primary(): SkillStackItem | undefined {
    return this.stack.find(s => s.role === 'primary')
  }

  /**
   * 获取辅 skill 列表
   */
  secondaries(): SkillStackItem[] {
    return this.stack.filter(s => s.role === 'secondary')
  }

  /**
   * 移除指定 skill
   */
  remove(skillName: string): void {
    this.stack = this.stack.filter(s => s.skill.name !== skillName)
  }

  /**
   * 清空栈
   */
  clear(): void {
    this.stack = []
  }

  /**
   * 栈是否为空
   */
  isEmpty(): boolean {
    return this.stack.length === 0
  }

  /**
   * 生成 system prompt 注入文本
   */
  toPromptString(): string {
    if (this.stack.length === 0) return ''

    const lines: string[] = ['## 当前激活技能栈\n']

    // 按激活时间排序，primary 在前
    const sorted = [...this.stack].sort((a, b) => {
      if (a.role === 'primary' && b.role !== 'primary') return -1
      if (a.role !== 'primary' && b.role === 'primary') return 1
      return a.activatedAt - b.activatedAt
    })

    for (let i = 0; i < sorted.length; i++) {
      const item = sorted[i]
      const roleLabel = item.role === 'primary' ? '主' : '辅'
      lines.push(`${i + 1}. ${item.skill.name} (${roleLabel}) — ${item.skill.description || '无描述'}`)
      if (item.instructions) {
        lines.push(`\n${item.instructions}\n`)
      }
    }

    lines.push(`\n请严格遵循上述技能的指令与规则。`)
    return lines.join('\n')
  }
}

/**
 * 从用户意图推断需要的 skill 组合
 * 例如："重构这个模块，写好测试，准备 PR" → planning + tdd + finishing-branch
 */
export function inferSkillStack(userInput: string): string[] {
  const skills: string[] = []
  const input = userInput.toLowerCase()

  // 检测是否涉及多步骤任务
  const multiStepPatterns = [/重构|refactor/i, /测试|test/i, /提交|commit|pr|merge/i]
  const matchCount = multiStepPatterns.filter(p => p.test(input)).length

  if (matchCount >= 2) {
    // 多步骤任务，先加 planning
    if (/重构|模块|设计/i.test(input)) {
      skills.push('planning')
    }
  }

  // 检测具体 skill 需求
  if (/测试|test|tdd/i.test(input)) skills.push('tdd')
  if (/重构|refactor|模块.*重构/i.test(input) && !skills.includes('planning')) {
    skills.push('planning')
  }
  if (/完成|提交|commit|pr|merge/i.test(input)) skills.push('finishing-branch')
  if (/调试|debug|bug/i.test(input)) skills.push('debugging')

  // 去重，保持顺序
  return [...new Set(skills)]
}
