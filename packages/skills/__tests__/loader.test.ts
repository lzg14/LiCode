import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadAllSkills, findSkill, SkillLoader } from '../loader'
import { globalSkillRegistry } from '../registry'
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('SkillLoader', () => {
  let testDir: string
  let loader: SkillLoader

  beforeEach(() => {
    testDir = join(tmpdir(), `test-skills-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
    loader = new SkillLoader()
    // 清理所有已注册的技能
    const existingSkills = globalSkillRegistry.list()
    for (const skill of existingSkills) {
      globalSkillRegistry.unregister(skill.name)
    }
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  describe('loadAllSkills', () => {
    it('should load skills from directories', async () => {
      // 创建一个测试技能目录
      const skillDir = join(testDir, 'test-skill')
      mkdirSync(skillDir, { recursive: true })
      
      const skillContent = `---
name: test-skill
description: A test skill
---
This is a test skill instruction.`
      
      writeFileSync(join(skillDir, 'SKILL.md'), skillContent)
      
      // 加载技能
      const skills = await loader.loadFromDir(testDir)
      
      expect(skills).toBe(1)
      const registeredSkills = globalSkillRegistry.list()
      expect(registeredSkills.length).toBe(1)
      expect(registeredSkills[0].name).toBe('test-skill')
    })

    it('should handle non-existent directory', async () => {
      const count = await loader.loadFromDir('/non-existent-dir')
      expect(count).toBe(0)
    })

    it('should create directory if not exists', async () => {
      const newDir = join(testDir, 'new-dir')
      const count = await loader.loadFromDir(newDir)
      expect(count).toBe(0)
      expect(existsSync(newDir)).toBe(true)
    })
  })

  describe('findSkill', () => {
    it('should find a skill by name', async () => {
      // 先加载技能
      const skillDir = join(testDir, 'findable-skill')
      mkdirSync(skillDir, { recursive: true })
      
      const skillContent = `---
name: findable-skill
description: A findable skill
---
This is a findable skill.`
      
      writeFileSync(join(skillDir, 'SKILL.md'), skillContent)
      await loader.loadFromDir(testDir)
      
      // 查找技能
      const found = await findSkill('findable-skill', testDir)
      
      expect(found).toBeDefined()
      expect(found?.name).toBe('findable-skill')
      expect(found?.description).toBe('A findable skill')
    })

    it('should return undefined for non-existent skill', async () => {
      const found = await findSkill('non-existent', testDir)
      expect(found).toBeUndefined()
    })
  })

  describe('skill content format', () => {
    it('should parse frontmatter correctly', async () => {
      const skillDir = join(testDir, 'formatted-skill')
      mkdirSync(skillDir, { recursive: true })
      
      const skillContent = `---
name: formatted-skill
description: A formatted skill
custom-field: custom-value
---
This is the skill body with multiple lines.

Second paragraph.`
      
      writeFileSync(join(skillDir, 'SKILL.md'), skillContent)
      await loader.loadFromDir(testDir)
      
      const skill = globalSkillRegistry.findByName('formatted-skill')
      
      expect(skill).toBeDefined()
      expect(skill?.name).toBe('formatted-skill')
      expect(skill?.description).toBe('A formatted skill')
      expect(skill?.instructions).toContain('This is the skill body with multiple lines.')
      expect(skill?.instructions).toContain('Second paragraph.')
      expect(skill?.triggerWords).toContain('formatted-skill')
    })

    it('should handle skill without frontmatter', async () => {
      const skillContent = `# No Frontmatter Skill
description: Simple description
triggers: trigger1, trigger2

## Instructions
Some instructions here.`
      
      const skillPath = join(testDir, 'no-frontmatter.skill.md')
      writeFileSync(skillPath, skillContent)
      await loader.loadSkill(skillPath)
      
      const skill = globalSkillRegistry.findByName('No Frontmatter Skill')
      
      expect(skill).toBeDefined()
      expect(skill?.name).toBe('No Frontmatter Skill')
      expect(skill?.description).toBe('Simple description')
      expect(skill?.triggerWords).toContain('trigger1')
      expect(skill?.triggerWords).toContain('trigger2')
    })

    it('should handle JSON skill file', async () => {
      const skillJson = {
        name: 'json-skill',
        description: 'A JSON skill',
        triggerWords: ['json-trigger'],
        instructions: 'JSON skill instructions',
        sandboxLevel: 1,
      }
      
      const skillPath = join(testDir, 'json-skill.skill.json')
      writeFileSync(skillPath, JSON.stringify(skillJson))
      await loader.loadSkill(skillPath)
      
      const skill = globalSkillRegistry.findByName('json-skill')
      
      expect(skill).toBeDefined()
      expect(skill?.name).toBe('json-skill')
      expect(skill?.triggerWords).toContain('json-trigger')
    })
  })
})