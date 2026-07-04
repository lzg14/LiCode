import { join } from 'node:path'
import { z } from 'zod'
import type { ToolRegistry } from '../registry'

function registerSkill(registry: ToolRegistry): void {
  registry.register({
    name: 'skill',
    description: '加载并执行技能。技能是位于 ~/.licode/skills/ 或项目 skills/ 目录下的 .skill.json / .skill.md 文件，包含专业知识和工作流程。',
    inputSchema: z.object({
      name: z.string().describe('技能名称'),
      args: z.record(z.string(), z.unknown()).optional().describe('传递给技能的参数'),
    }),
    handler: async ({ name, args }: { name: string; args?: Record<string, unknown> }) => {
      const home = process.env.HOME || process.env.USERPROFILE || ''
      const skillDirs = [
        join(home, '.licode', 'skills'),
        join(home, '.licode', 'skills', 'builtin'),
        join(process.cwd(), 'skills'),
      ]

      const { skillLoader } = await import('../../skills/loader')
      for (const dir of skillDirs) {
        await skillLoader.loadFromDir(dir)
      }

      const { globalSkillRegistry } = await import('../../skills/registry')
      const skill = globalSkillRegistry.findByName(name)
      if (!skill) {
        const loaded = globalSkillRegistry.list().map(s => s.name).join(', ')
        return { success: false, error: `技能 "${name}" 未找到。已加载: ${loaded || '(无)'}。搜索路径: ${skillDirs.join(', ')}` }
      }

      return {
        success: true,
        output: `## 技能已激活: ${skill.name}\n\n${skill.instructions}`,
      }
    },
  })
}

export function registerSkillTools(registry: ToolRegistry): void {
  registerSkill(registry)
}
