export interface Skill {
  name: string
  description: string
  triggerWords: string[]
  instructions: string
  sandboxLevel: 1 | 2 | 3 | 4
  /** 从 SKILL.md "## 何时用" 段落提取的触发提示 */
  triggerHints?: string
  /** SKILL.md 文件位置 */
  path?: string
}

/** 用于 system prompt 注入的 skill 摘要 */
export interface SkillIndex {
  name: string
  description: string
  triggerHints: string
  /** SKILL.md 文件位置，供模型按需 read 加载 */
  path?: string
}

export interface SkillResult {
  success: boolean
  output?: string
  error?: string
}

export interface SkillExecution {
  skillName: string
  timestamp: number
  success: boolean
  feedback?: string
}
