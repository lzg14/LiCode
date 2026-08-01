import type { SkillIndex } from './types'

interface SkillRule {
  skill: string
  patterns: RegExp[]
  keywords: string[]
  excludePatterns?: RegExp[]
}

const SKILL_RULES: SkillRule[] = [
  {
    skill: 'tdd',
    patterns: [
      /写.*测试|写.*test/i,
      /测试驱动|tdd/i,
      /新功能.*实现|实现.*新功能/i,
    ],
    keywords: ['测试', 'test', 'tdd', '新功能', 'feature'],
    excludePatterns: [/修.*bug|fix.*bug/i],
  },
  {
    skill: 'debugging',
    patterns: [
      /bug|调试|debug/i,
      /报错|error|异常/i,
      /不工作|不运行|跑不通/i,
    ],
    keywords: ['bug', '调试', 'debug', '报错', '异常'],
  },
  {
    skill: 'planning',
    patterns: [
      /重构.*模块|模块.*重构/i,
      /多.*文件|跨.*文件/i,
      /计划|plan|方案/i,
    ],
    keywords: ['重构', 'refactor', '计划', '方案'],
  },
  {
    skill: 'verification',
    patterns: [
      /完成|修好了|搞定了|可以了/i,
      /commit|提交|push/i,
      /验收|review/i,
    ],
    keywords: ['完成', '修好', 'commit', '提交'],
  },
  {
    skill: 'simplify',
    patterns: [
      /精简|简化|瘦身/i,
      /过度设计|over.?engineer/i,
      /代码.*太.*复杂/i,
    ],
    keywords: ['精简', '简化', '瘦身', 'simplify'],
  },
  {
    skill: 'parallel-agents',
    patterns: [
      /并行|parallel/i,
      /同时.*做|一起.*做/i,
      /拆.*任务|分.*任务/i,
    ],
    keywords: ['并行', 'parallel', '同时', '拆分'],
  },
  {
    skill: 'finishing-branch',
    patterns: [
      /merge|合并|pr|pull request/i,
      /准备.*合并|准备.*pr/i,
    ],
    keywords: ['merge', '合并', 'pr', 'pull request'],
  },
  {
    skill: 'architecture',
    patterns: [
      /架构|architecture/i,
      /模块.*设计|设计.*模块/i,
    ],
    keywords: ['架构', 'architecture', '模块设计'],
  },
  {
    skill: 'git-worktrees',
    patterns: [
      /worktree|工作树/i,
      /隔离.*环境|环境.*隔离/i,
    ],
    keywords: ['worktree', '工作树', '隔离环境'],
  },
]

/**
 * 根据用户输入匹配可能适用的 skill
 * @param input 用户输入文本
 * @param availableSkills 可用 skill 列表
 * @param currentSkill 当前已激活的 skill（如有则跳过）
 * @returns 匹配到的 skill 列表
 */
export function matchSkills(
  input: string,
  availableSkills: SkillIndex[],
  currentSkill?: string | null,
): SkillIndex[] {
  if (!input || availableSkills.length === 0) return []

  const inputLower = input.toLowerCase()
  const availableNames = new Set(availableSkills.map(s => s.name))

  const matched = SKILL_RULES.filter(rule => {
    // 跳过当前已激活的 skill
    if (currentSkill && rule.skill === currentSkill) return false
    // 跳过不在可用列表中的 skill
    if (!availableNames.has(rule.skill)) return false
    // 排除条件
    if (rule.excludePatterns?.some(p => p.test(input))) return false
    // 模式匹配
    if (rule.patterns.some(p => p.test(input))) return true
    // 关键词匹配
    if (rule.keywords.some(kw => inputLower.includes(kw))) return true
    return false
  })

  return matched
    .map(rule => availableSkills.find(s => s.name === rule.skill)!)
    .filter(Boolean)
}
