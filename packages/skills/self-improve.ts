import type { SkillExecution } from './types'

export interface SkillSelfImprove {
  recordExecution(skillName: string, success: boolean, feedback?: string): void
  generateImprovement(skillName: string): Promise<string | null>
}

export class SkillSelfImproveImpl implements SkillSelfImprove {
  private executions = new Map<string, SkillExecution[]>()

  recordExecution(skillName: string, success: boolean, feedback?: string): void {
    const records = this.executions.get(skillName) ?? []
    records.push({
      skillName,
      timestamp: Date.now(),
      success,
      feedback,
    })
    // 保留最近 100 条
    if (records.length > 100) records.shift()
    this.executions.set(skillName, records)
  }

  async generateImprovement(skillName: string): Promise<string | null> {
    const records = this.executions.get(skillName) ?? []
    const failures = records.filter(r => !r.success)
    if (failures.length < 3) return null

    const feedback = failures
      .map(f => f.feedback)
      .filter(Boolean)
      .join('\n')

    return `Based on ${failures.length} failures:\n${feedback}`
  }
}

export const skillSelfImprove = new SkillSelfImproveImpl()
