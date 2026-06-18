import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync } from 'fs'
import { join, extname } from 'path'
import { homedir } from 'os'
import type { Skill } from './types'
import { globalSkillRegistry } from './registry'

/**
 * 技能系统 - 技能注册、加载、热更新
 */

const SKILLS_BASE = join(homedir(), '.licode', 'skills')

export class SkillLoader {
  private loadedSkills = new Set<string>()

  /**
   * 从目录加载所有技能
   */
  async loadFromDir(dir: string): Promise<number> {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
      return 0
    }

    let count = 0
    const files = readdirSync(dir).filter(f => f.endsWith('.skill.json') || f.endsWith('.skill.md'))

    for (const file of files) {
      const skillPath = join(dir, file)
      if (await this.loadSkill(skillPath)) {
        count++
      }
    }

    return count
  }

  /**
   * 加载单个技能文件
   */
  async loadSkill(skillPath: string): Promise<boolean> {
    try {
      if (!existsSync(skillPath)) return false

      const content = readFileSync(skillPath, 'utf-8')
      let skill: Skill

      if (skillPath.endsWith('.json')) {
        skill = JSON.parse(content)
      } else if (skillPath.endsWith('.md')) {
        skill = this.parseMarkdownSkill(content)
      } else {
        return false
      }

      if (!skill.name) return false

      globalSkillRegistry.register(skill)
      this.loadedSkills.add(skillPath)
      return true
    } catch {
      return false
    }
  }

  /**
   * 从 Markdown 解析技能
   */
  private parseMarkdownSkill(content: string): Skill {
    const lines = content.split('\n')
    let name = ''
    let description = ''
    let instructions = ''
    const triggerWords: string[] = []

    for (const line of lines) {
      if (line.startsWith('# ')) {
        name = line.slice(2).trim()
      } else if (line.startsWith('description:')) {
        description = line.slice(12).trim()
      } else if (line.startsWith('triggers:')) {
        const triggers = line.slice(9).trim()
        triggerWords.push(...triggers.split(',').map(t => t.trim()))
      } else if (line.startsWith('## Instructions')) {
        instructions = lines.slice(lines.indexOf(line) + 1).join('\n').trim()
        break
      }
    }

    return {
      name: name || 'unnamed',
      description: description || 'No description',
      triggerWords: triggerWords.length > 0 ? triggerWords : [name.toLowerCase()],
      instructions: instructions || 'No instructions',
      sandboxLevel: 1,
    }
  }

  /**
   * 保存技能到文件
   */
  async saveSkill(skill: Skill, dir?: string): Promise<string> {
    const saveDir = dir || join(SKILLS_BASE, 'custom')
    mkdirSync(saveDir, { recursive: true })

    const filename = `${skill.name.replace(/\s+/g, '-').toLowerCase()}.skill.json`
    const filepath = join(saveDir, filename)

    writeFileSync(filepath, JSON.stringify(skill, null, 2))
    globalSkillRegistry.register(skill)

    return filepath
  }

  /**
   * 获取已加载的技能列表
   */
  getLoadedSkills(): string[] {
    return Array.from(this.loadedSkills)
  }
}

export const skillLoader = new SkillLoader()
