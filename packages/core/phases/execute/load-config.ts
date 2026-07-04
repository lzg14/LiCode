import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { devLogger } from "../../dev-logger"

const projectConfigCache = new Map<string, string>()

/** 清除配置缓存（开发场景下文件变更后调用） */
export function clearProjectConfigCache(): void {
  projectConfigCache.clear()
}

export async function loadProjectConfig(cwd?: string): Promise<string> {
  const dir = cwd || process.cwd()

  if (projectConfigCache.has(dir)) {
    return projectConfigCache.get(dir)!
  }

  const configFiles = ['.licode.md', 'LICODE.md', '.licode/LICODE.md']

  const homes = process.env.HOME || process.env.USERPROFILE || ''
  let globalConfig = ''
  if (homes) {
    const globalPaths = [
      join(homes, '.licode', 'CLAUDE.md'),
      join(homes, '.licode', 'LICODE.md'),
    ]
    for (const p of globalPaths) {
      try {
        if (existsSync(p)) {
          globalConfig = await readFile(p, 'utf-8')
          devLogger.debug('PROJECT_CONFIG', `Loaded global ${p}`)
          break
        }
      } catch (e) {
        devLogger.debug('PROJECT_CONFIG', `Failed to load global ${p}`, e)
      }
    }
  }

  let projectConfig = ''
  for (const file of configFiles) {
    const fullPath = join(dir, file)
    try {
      if (existsSync(fullPath)) {
        projectConfig = await readFile(fullPath, 'utf-8')
        devLogger.debug('PROJECT_CONFIG', `Loaded project ${fullPath}`)
        break
      }
    } catch (e) {
      devLogger.debug('PROJECT_CONFIG', `Failed to load ${fullPath}`, e)
    }
  }

  if (!projectConfig) {
    let currentDir = dir
    while (currentDir !== dirname(currentDir)) {
      currentDir = dirname(currentDir)
      for (const file of configFiles) {
        const fullPath = join(currentDir, file)
        try {
          if (existsSync(fullPath)) {
            projectConfig = await readFile(fullPath, 'utf-8')
            devLogger.debug('PROJECT_CONFIG', `Loaded project ${fullPath}`)
            break
          }
        } catch (e) {
          devLogger.debug('PROJECT_CONFIG', `Failed to load ${fullPath}`, e)
        }
      }
      if (projectConfig) break
    }
  }

  let result: string
  if (projectConfig && globalConfig) {
    result = `## 全局规则\n\n${globalConfig}\n\n## 项目规则\n\n${projectConfig}`
  } else {
    result = projectConfig || globalConfig
  }

  projectConfigCache.set(dir, result)
  return result
}
