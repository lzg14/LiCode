import { existsSync, readFileSync } from 'fs'
import { SessionManager } from './session'
import { hasMemoryOrTasks, renderRebuildContext } from './checkpoint'
import { checkpointPath } from './checkpoint-paths'

/**
 * 构建会话上下文的 system prompt 注入部分。
 * 包含：
 * 1. 主动回忆提醒（如果有 memory artifacts）
 * 2. checkpoint/memory 重建上下文
 */
export function buildSessionContext(input: {
  sessionID: string
  dataDir: string
  projectID?: string
}): string {
  const lines: string[] = []

  const rebuildCtx = renderRebuildContext({
    sessionID: input.sessionID,
    dataDir: input.dataDir,
    projectID: input.projectID,
  })
  if (rebuildCtx) {
    lines.push(rebuildCtx)
  }

  if (hasMemoryOrTasks(input.sessionID, input.dataDir)) {
    lines.push(buildRecallReminder(input.sessionID, input.dataDir))
  }

  return lines.join('\n')
}

/**
 * 主动回忆提醒 —— 每个用户消息轮次注入。
 * 告诉 LLM 它可以用什么方式搜索记忆。
 */
export function buildRecallReminder(sessionID: string, dataDir: string): string {
  return [
    '<system-reminder>',
    `This session has memory at ${dataDir}/memory/sessions/${sessionID}/. ` +
    'Recall content not in your context with:',
    `- Read(file_path="${dataDir}/memory/sessions/${sessionID}/checkpoint.md")`,
    `- Read(file_path="${dataDir}/memory/sessions/${sessionID}/notes.md")`,
    '- grep (for specific facts across memory files)',
    "Don't ask the user about something memory may already record.",
    '</system-reminder>',
  ].join('\n')
}

/**
 * 构建上下文继承注入 —— 当子会话有 contextFrom/contextWatermark 时，
 * 把父会话的摘要注入到 system prompt 中。
 */
export function buildContextInheritance(input: {
  currentSessionID: string
  sessionManager: SessionManager
  dataDir: string
}): string {
  const session = input.sessionManager.getSession(input.currentSessionID)
  if (!session?.contextFrom) return ''

  const parent = input.sessionManager.getSession(session.contextFrom)
  if (!parent) return ''

  const lines: string[] = []
  lines.push('<system-reminder>')
  lines.push('This session inherits context from a parent session.')
  lines.push(`Parent session: ${parent.title} (${session.contextFrom})`)
  lines.push('')

  const parentMsgs = input.sessionManager.getMessages(session.contextFrom)
  const watermarkIdx = session.contextWatermark
    ? parentMsgs.findIndex(m => m.id === session.contextWatermark)
    : -1

  if (watermarkIdx >= 0) {
    const inheritedCount = watermarkIdx + 1
    const totalParentCount = parentMsgs.length
    lines.push(
      `Inherited ${inheritedCount}/${totalParentCount} messages from parent ` +
      `(up to message ${session.contextWatermark}).`,
    )
  } else {
    lines.push(`All ${parentMsgs.length} messages from parent session are inherited.`)
  }

  if (parent.summary) {
    lines.push('')
    lines.push('Parent session summary:')
    if (parent.summary.additions > 0 || parent.summary.deletions > 0) {
      lines.push(`- Changes: +${parent.summary.additions}/-${parent.summary.deletions} lines`)
    }
    if (parent.summary.files.length > 0) {
      lines.push(`- Files: ${parent.summary.files.join(', ')}`)
    }
  }

  const cpPath = checkpointPath(session.contextFrom, input.dataDir)
  if (existsSync(cpPath)) {
    const parentCheckpoint = readFileSync(cpPath, 'utf-8')
    lines.push('')
    lines.push('Parent checkpoint context:')
    lines.push(parentCheckpoint)
  }

  lines.push('</system-reminder>')
  lines.push('')
  return lines.join('\n')
}
