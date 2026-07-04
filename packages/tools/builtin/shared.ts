import { exec, execFile } from 'node:child_process'
import { promisify } from 'node:util'

export const execAsync = promisify(exec)
export const execFileAsync = promisify(execFile)

export const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'])
