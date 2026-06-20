import { readFileSync, writeFileSync, existsSync } from 'fs'
import { dirname } from 'path'
import { SessionManager } from './session'
import { checkpointPath, memoryPath, notesPath, ensureDir, metaDir, memoryRoot } from './checkpoint-paths'

export const CHECKPOINT_TEMPLATE = `# Session checkpoint

## Active intent
_User's most recent explicit request_

(none yet)

## Next concrete action
_The single next concrete step_

(none yet)

## Current work
_What was being done immediately before this checkpoint_

(none yet)

## Files and code sections
_Files actively being read or modified_

(none yet)

## Discovered knowledge
_Facts learned during this session_

(none yet)

## Errors and fixes
_Errors encountered and how they were resolved_

(none)

## Design decisions
_Decisions reached through discussion_

(none yet)

## Open notes
_Anything else that doesn't fit above_

(none yet)
`

export const MEMORY_TEMPLATE = `# Project memory
_Durable project-level knowledge. Persists across all sessions in this project._

## Project context
_What is this project? What's its goal?_

(none yet)

## Rules
_Hard constraints from user that every session must respect._

(none yet)

## Architecture decisions
_Major design choices with rationale._

(none yet)

## Discovered durable knowledge
_Cross-task facts that survive across sessions._

(none yet)
`

export const NOTES_TEMPLATE = `# Session notes
_Free-form scratchpad._

(none yet)
`

export interface CheckpointInput {
  sessionID: string
  dataDir: string
  projectID?: string
  useCount: number
}

export interface CheckpointWriterInput extends CheckpointInput {
  text: string
  memoryText?: string
}

export function ensureCheckpointTemplate(filePath: string): void {
  if (!existsSync(filePath)) {
    ensureDir(dirname(filePath))
    writeFileSync(filePath, CHECKPOINT_TEMPLATE, 'utf-8')
  }
}

export function ensureMemoryTemplate(filePath: string): void {
  if (!existsSync(filePath)) {
    ensureDir(dirname(filePath))
    writeFileSync(filePath, MEMORY_TEMPLATE, 'utf-8')
  }
}

export function ensureNotesTemplate(filePath: string): void {
  if (!existsSync(filePath)) {
    ensureDir(dirname(filePath))
    writeFileSync(filePath, NOTES_TEMPLATE, 'utf-8')
  }
}

export function writeCheckpoint(input: CheckpointWriterInput): void {
  const sessDir = metaDir(input.sessionID, input.dataDir)
  ensureDir(sessDir)
  ensureCheckpointTemplate(checkpointPath(input.sessionID, input.dataDir))

  const cpPath = checkpointPath(input.sessionID, input.dataDir)
  writeFileSync(cpPath, input.text, 'utf-8')
}

export function writeMemory(input: { projectID: string; dataDir: string; text: string }): void {
  const mpPath = memoryPath(input.projectID, input.dataDir)
  ensureDir(dirname(mpPath))
  ensureMemoryTemplate(mpPath)
  writeFileSync(mpPath, input.text, 'utf-8')
}

export function loadCheckpoint(sessionID: string, dataDir: string): string | undefined {
  const path = checkpointPath(sessionID, dataDir)
  if (!existsSync(path)) return undefined
  return readFileSync(path, 'utf-8')
}

export function loadMemory(projectID: string, dataDir: string): string | undefined {
  const path = memoryPath(projectID, dataDir)
  if (!existsSync(path)) return undefined
  return readFileSync(path, 'utf-8')
}

export function loadGlobalMemory(dataDir: string): string | undefined {
  const path = memoryPath('global', dataDir)
  if (!existsSync(path)) return undefined
  return readFileSync(path, 'utf-8')
}

export function hasCheckpoint(sessionID: string, dataDir: string): boolean {
  return existsSync(checkpointPath(sessionID, dataDir))
}

export function hasMemoryOrTasks(sessionID: string, dataDir: string): boolean {
  const sessDir = metaDir(sessionID, dataDir)
  return existsSync(sessDir)
}

/**
 * 构建 rebuild 上下文，注入到 LLM 的 system prompt 中。
 * 返回格式化文本，包含 checkpoint、project memory、global memory。
 */
export function renderRebuildContext(input: {
  sessionID: string
  dataDir: string
  projectID?: string
}): string {
  const { sessionID, dataDir, projectID } = input
  const lines: string[] = []

  const cp = loadCheckpoint(sessionID, dataDir)
  const mem = projectID ? loadMemory(projectID, dataDir) : undefined
  const globalMem = loadGlobalMemory(dataDir)

  const hasAny = cp || mem || globalMem
  if (!hasAny) return ''

  lines.push(
    '<system-reminder>',
    'The following blocks are auto-loaded from session memory. ' +
    'They are already in your context — do not Read them as whole files. ' +
    'Use Grep for specific facts instead.',
    '</system-reminder>',
    '',
  )

  if (cp) {
    lines.push('## Session checkpoint')
    lines.push(cp.trim())
    lines.push('')
  }

  if (mem) {
    lines.push('## Project memory')
    lines.push(mem.trim())
    lines.push('')
  }

  if (globalMem) {
    lines.push('## Global memory')
    lines.push(globalMem.trim())
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * 计算 checkpoint 的消息摘要边界。
 * 从最后一条已完成的 assistant 消息往前推，保留足够的尾部上下文。
 */
export function computeBoundary(
  msgs: ReadonlyArray<{ info: { id: string; role: string; finish?: string } }>,
): string {
  if (msgs.length === 0) return ''

  const lastAsstIdx = findLastIndex(msgs, m => m.info.role === 'assistant' && m.info.finish !== undefined)
  if (lastAsstIdx <= 0) {
    return msgs[lastAsstIdx >= 0 ? lastAsstIdx : 0].info.id
  }

  return msgs[lastAsstIdx - 1].info.id
}

function findLastIndex<T>(arr: ReadonlyArray<T>, predicate: (item: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (predicate(arr[i])) return i
  }
  return -1
}

/**
 * 通过 checkpoint 更新 session 的 lastCheckpointMessageId
 */
export function advanceCheckpoint(sessionManager: SessionManager, sessionID: string, messageID: string): void {
  sessionManager.updateSession(sessionID, { lastCheckpointMessageId: messageID })
}
