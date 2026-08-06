import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { devLogger } from '../core/dev-logger'
import { exists } from '../core/utils/fs'
import { globalSkillRegistry } from './registry'
import type { Skill, SkillIndex } from './types'

/**
 * 技能系统 - 技能注册、加载、热更新
 * 支持 Claude Code `~/.claude/skills/` 格式
 */

interface SkillMeta {
  name: string
  description: string
  [key: string]: string
}

/**
 * 解析 YAML frontmatter（宽松匹配，只取 name/description）
 */
function parseFrontmatter(raw: string): { meta: SkillMeta; body: string } {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!m) return { meta: { name: '', description: '' }, body: raw }
  
  const meta: SkillMeta = { name: '', description: '' }
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.+)$/)
    if (kv) meta[kv[1]] = kv[2].trim()
  }
  return { meta, body: m[2] }
}

/**
 * 从 SKILL.md 正文提取 "## 何时用" 段落作为 triggerHints
 * 格式：提取 "## 何时用" 到下一个 "##" 之间的列表项，用分号连接
 */
export function extractTriggerHints(instructions: string): string {
  const match = instructions.match(/## 何时用\n([\s\S]*?)(?=\n##|$)/)
  if (match) {
    return match[1].trim().split('\n')
      .filter(line => line.startsWith('- '))
      .map(line => line.slice(2).trim())
      .join('；')
  }
  return ''
}

export class SkillLoader {
  private loadedSkills = new Set<string>()

  /**
   * 从目录加载所有技能（支持 Claude Code {name}/SKILL.md 格式）
   */
  async loadFromDir(dir: string): Promise<number> {
    if (!(await exists(dir))) {
      await mkdir(dir, { recursive: true })
      return 0
    }

    let count = 0
    
    // Claude Code 格式：{dir}/{name}/SKILL.md
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillFile = join(dir, entry.name, 'SKILL.md')
        if (await exists(skillFile)) {
          if (await this.loadClaudeSkill(skillFile, entry.name)) {
            count++
          }
        }
      }
    }

    // 旧格式：.skill.json / .skill.md 文件
    const files = (await readdir(dir)).filter(f => f.endsWith('.skill.json') || f.endsWith('.skill.md'))
    for (const file of files) {
      const skillPath = join(dir, file)
      if (await this.loadSkill(skillPath)) {
        count++
      }
    }

    return count
  }

  /**
   * 加载 Claude Code SKILL.md 文件
   */
  private async loadClaudeSkill(skillPath: string, dirName: string): Promise<boolean> {
    try {
      if (!(await exists(skillPath))) return false
      if (this.loadedSkills.has(skillPath)) return true

      const content = await readFile(skillPath, 'utf-8')
      const { meta, body } = parseFrontmatter(content)
      
      const skill: Skill = {
        name: meta.name || dirName,
        description: meta.description || '',
        triggerWords: [meta.name || dirName],
        instructions: body,
        sandboxLevel: 1,
        triggerHints: extractTriggerHints(body),
        path: skillPath, // 新增：保存 SKILL.md 位置
      }

      globalSkillRegistry.register(skill)
      this.loadedSkills.add(skillPath)
      return true
    } catch (e) {
      devLogger.debug('SKILL', `loadClaudeSkill failed: ${skillPath}`, e)
      return false
    }
  }

  /**
   * 加载单个技能文件（旧格式）
   */
  async loadSkill(skillPath: string): Promise<boolean> {
    try {
      if (!(await exists(skillPath))) return false
      if (this.loadedSkills.has(skillPath)) return true

      const content = await readFile(skillPath, 'utf-8')
      let skill: Skill

      if (skillPath.endsWith('.json')) {
        skill = JSON.parse(content)
      } else if (skillPath.endsWith('.md')) {
        skill = this.parseMarkdownSkill(content)
      } else {
        return false
      }

      if (!skill.name) return false

      // 保存 path
      skill.path = skillPath

      globalSkillRegistry.register(skill)
      this.loadedSkills.add(skillPath)
      return true
    } catch (e) {
      devLogger.debug('SKILL', `loadSkill failed: ${skillPath}`, e)
      return false
    }
  }

  /**
   * 从 Markdown 解析技能（旧格式）
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
    await mkdir(saveDir, { recursive: true })

    const filename = `${skill.name.replace(/\s+/g, '-').toLowerCase()}.skill.json`
    const filepath = join(saveDir, filename)

    await writeFile(filepath, JSON.stringify(skill, null, 2))
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

const SKILLS_BASE = join(homedir(), '.licode', 'skills')
export const skillLoader = new SkillLoader()

/**
 * 加载所有技能（global + project）
 */
export async function loadAllSkills(cwd?: string): Promise<Skill[]> {
  const home = homedir()

  // 全局 Claude Code skills
  const globalDirs = [
    join(home, '.claude', 'skills'),
    join(home, '.licode', 'skills'),
  ]

  // 项目级 skills（向上找第一个 .claude/skills/）
  const projectDirs: string[] = []
  if (cwd) {
    let dir = cwd
    while (dir !== dirname(dir)) {
      const claudeSkills = join(dir, '.claude', 'skills')
      if (await exists(claudeSkills)) {
        projectDirs.push(claudeSkills)
        break
      }
      dir = dirname(dir)
    }
  }

  // 加载顺序：project → global（global 覆盖 project）
  const allDirs = [...projectDirs, ...globalDirs]
  for (const dir of allDirs) {
    await skillLoader.loadFromDir(dir)
  }

  return globalSkillRegistry.list()
}

/**
 * 按名查找技能
 */
export async function findSkill(name: string, cwd?: string): Promise<Skill | undefined> {
  await loadAllSkills(cwd)
  return globalSkillRegistry.findByName(name)
}

/**
 * 获取所有 skill 的索引信息（用于 system prompt 注入）
 * 增加 path 字段，支持按需 read 加载
 */
export async function getSkillIndex(cwd?: string): Promise<SkillIndex[]> {
  const skills = await loadAllSkills(cwd)
  return skills.map(s => ({
    name: s.name,
    description: s.description,
    triggerHints: s.triggerHints || '',
    path: s.path, // 新增：SKILL.md 文件位置，供模型按需 read
  }))
}
