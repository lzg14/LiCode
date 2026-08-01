import type { Message, Part, PartType, Session, SessionStatus } from './types'

export interface SessionRow {
  id: string
  title: string
  directory: string
  parent_id: string | null
  context_from: string | null
  context_watermark: string | null
  status: string
  model: string | null
  provider: string | null
  token_input: number | null
  token_output: number | null
  cost: number | null
  summary_additions: number | null
  summary_deletions: number | null
  summary_files: string | null
  last_checkpoint_message_id: string | null
  created_at: number
  updated_at: number
  completed_at: number | null
}

export const SESSION_STATUSES: readonly SessionStatus[] = ['idle', 'running', 'blocked', 'completed', 'failed']

/** SQLite 没 enum 约束，DB 里的 status 可能是任意字符串。运行时验证兜底 */
export function parseSessionStatus(raw: string): SessionStatus {
  return (SESSION_STATUSES as readonly string[]).includes(raw) ? (raw as SessionStatus) : 'failed'
}

export function rowToSession(row: SessionRow): Session {
  const summaryFiles = row.summary_files ? (JSON.parse(row.summary_files) as string[]) : undefined
  return {
    id: row.id,
    title: row.title,
    directory: row.directory,
    parentId: row.parent_id ?? undefined,
    contextFrom: row.context_from ?? undefined,
    contextWatermark: row.context_watermark ?? undefined,
    status: parseSessionStatus(row.status),
    model: row.model ?? undefined,
    provider: row.provider ?? undefined,
    tokenUsage: (row.token_input ?? 0) > 0 ? {
      input: row.token_input ?? 0,
      output: row.token_output ?? 0,
      total: (row.token_input ?? 0) + (row.token_output ?? 0),
    } : undefined,
    cost: row.cost ?? undefined,
    summary: (row.summary_additions ?? 0) > 0 || (row.summary_deletions ?? 0) > 0 || summaryFiles ? {
      additions: row.summary_additions ?? 0,
      deletions: row.summary_deletions ?? 0,
      files: summaryFiles ?? [],
    } : undefined,
    lastCheckpointMessageId: row.last_checkpoint_message_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? undefined,
  }
}

/** AI SDK type → PartType 映射 */
export function inferPartType(t: string): PartType {
  switch (t) {
    case 'text': return 'text'
    case 'reasoning': return 'reasoning'
    case 'tool-call': return 'tool-call'
    case 'tool-result': return 'tool-result'
    case 'file': return 'file'
    default: return 'text'
  }
}

export function rowToMessage(row: Record<string, unknown>): Message {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    role: row.role as Message['role'],
    content: row.content as string,
    agent: row.agent as string | undefined,
    model: row.model as string | undefined,
    tokenUsage: (row.token_input as number) > 0 ? {
      input: row.token_input as number,
      output: row.token_output as number,
    } : undefined,
    cost: row.cost as number | undefined,
    createdAt: row.created_at as number,
  }
}

export function rowToPart(row: Record<string, unknown>): Part {
  return {
    id: row.id as string,
    messageId: row.message_id as string,
    type: row.type as PartType,
    content: row.content as string,
    toolName: row.tool_name as string | undefined,
    toolCallId: row.tool_call_id as string | undefined,
    args: row.args ? JSON.parse(row.args as string) : undefined,
    result: row.result as string | undefined,
    metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
    createdAt: row.created_at as number,
  }
}
