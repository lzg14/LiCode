import type { Skill } from './types'

export class SkillRegistry {
  private skills = new Map<string, Skill>()

  register(skill: Skill): void {
    this.skills.set(skill.name, skill)
  }

  findByTrigger(word: string): Skill | undefined {
    for (const skill of this.skills.values()) {
      if (skill.triggerWords.some(tw => word.includes(tw))) {
        return skill
      }
    }
    return undefined
  }

  findByName(name: string): Skill | undefined {
    return this.skills.get(name)
  }

  list(): Skill[] {
    return Array.from(this.skills.values())
  }

  unregister(name: string): boolean {
    return this.skills.delete(name)
  }
}

export const globalSkillRegistry = new SkillRegistry()
