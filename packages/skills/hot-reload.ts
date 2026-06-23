import { watch, existsSync, readFileSync } from 'fs'
import type { Skill } from './types'
import { globalSkillRegistry } from './registry'

export class SkillHotReload {
  private watchers = new Map<string, () => void>()

  watch(skillPath: string): void {
    if (!existsSync(skillPath)) return

    const watcher = watch(skillPath, (eventType) => {
      if (eventType === 'change') {
        this.reload(skillPath)
      }
    })

    this.watchers.set(skillPath, () => watcher.close())
  }

  private reload(skillPath: string): void {
    try {
      const content = readFileSync(skillPath, 'utf-8')
      const skill = JSON.parse(content) as Skill
      globalSkillRegistry.register(skill)
      process.stderr.write(`[hot-reload] Skill reloaded: ${skill.name}\n`)
    } catch (e) {
      process.stderr.write(`[hot-reload] Failed to reload skill: ${skillPath} ${e}\n`)
    }
  }

  unwatch(skillPath: string): void {
    const close = this.watchers.get(skillPath)
    if (close) {
      close()
      this.watchers.delete(skillPath)
    }
  }

  unwatchAll(): void {
    for (const close of this.watchers.values()) {
      close()
    }
    this.watchers.clear()
  }
}

export const skillHotReload = new SkillHotReload()
