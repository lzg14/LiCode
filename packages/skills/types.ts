export interface Skill {
  name: string
  description: string
  triggerWords: string[]
  instructions: string
  sandboxLevel: 1 | 2 | 3 | 4
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
