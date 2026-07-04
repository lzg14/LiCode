import { globalSkillRegistry } from './registry'
import { skillSelfImprove } from './self-improve'
import type { SkillResult } from './types'

export class SkillExecutor {
  async execute(skillName: string, _context: Record<string, unknown> = {}): Promise<SkillResult> {
    const skill = globalSkillRegistry.findByName(skillName)
    if (!skill) {
      return { success: false, error: `Skill not found: ${skillName}` }
    }

    try {
      const output = `Executing skill: ${skill.name}\nInstructions: ${skill.instructions}`

      // 记录执行结果
      skillSelfImprove.recordExecution(skillName, true)

      return {
        success: true,
        output,
      }
    } catch (error) {
      skillSelfImprove.recordExecution(skillName, false, String(error))
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  async executeByTrigger(triggerWord: string): Promise<SkillResult> {
    const skill = globalSkillRegistry.findByTrigger(triggerWord)
    if (!skill) {
      return { success: false, error: `No skill found for trigger: ${triggerWord}` }
    }
    return this.execute(skill.name)
  }
}

export const skillExecutor = new SkillExecutor()
