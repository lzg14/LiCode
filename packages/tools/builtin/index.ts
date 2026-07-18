import { globalToolRegistry } from '../registry'
import { registerFSTools } from './fs'
import { registerSearchTools } from './search'
import { registerShellTools } from './shell'
import { registerGitTools } from './git'
import { registerWebTools } from './web'
import { registerDevTools } from './dev'
import { registerSkillTools } from './skill'
import { registerDatabaseTools } from './database'
import { registerPatchTools } from './patch'
import { registerExcelTools } from './excel'
import { registerMediaTools } from './media'
import { registerTodoTools } from './todo'

export function registerBuiltinTools(): void {
  registerFSTools(globalToolRegistry)
  registerSearchTools(globalToolRegistry)
  registerShellTools(globalToolRegistry)
  registerGitTools(globalToolRegistry)
  registerWebTools(globalToolRegistry)
  registerDevTools(globalToolRegistry)
  registerSkillTools(globalToolRegistry)
  registerDatabaseTools(globalToolRegistry)
  registerPatchTools(globalToolRegistry)
  registerExcelTools(globalToolRegistry)
  registerMediaTools(globalToolRegistry)
  registerTodoTools(globalToolRegistry)
}

export { readClipboardImage, readImageFile } from './media'
