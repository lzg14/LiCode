import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'

export function memoryRoot(dataDir: string): string {
  return join(dataDir, 'memory')
}

export function metaDir(sessionID: string, dataDir: string): string {
  return join(memoryRoot(dataDir), 'sessions', sessionID)
}

export function checkpointPath(sessionID: string, dataDir: string): string {
  return join(metaDir(sessionID, dataDir), 'checkpoint.md')
}

export function memoryPath(projectID: string, dataDir: string): string {
  return join(memoryRoot(dataDir), 'projects', projectID, 'MEMORY.md')
}

export function globalMemoryPath(dataDir: string): string {
  return join(memoryRoot(dataDir), 'global', 'MEMORY.md')
}

export function notesPath(sessionID: string, dataDir: string): string {
  return join(metaDir(sessionID, dataDir), 'notes.md')
}

export function tasksDir(sessionID: string, dataDir: string): string {
  return join(metaDir(sessionID, dataDir), 'tasks')
}

export function progressPath(sessionID: string, taskID: string, dataDir: string): string {
  return join(tasksDir(sessionID, dataDir), taskID, 'progress.md')
}

export function ensureDir(dir: string): void {
  if (dir && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}
