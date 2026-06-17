export type EventType =
  | 'command_blocked'
  | 'path_violation'
  | 'git_dangerous'
  | 'network_blocked'
  | 'sensitive_detected'
  | 'agent_spawned'
  | 'agent_terminated'
  | 'skill_executed'
  | 'plan_review'
  | 'phase_transition'

export interface SecurityEvent {
  type: EventType
  timestamp: number
  details: Record<string, unknown>
  action: 'blocked' | 'warned' | 'allowed_with_log'
}

export interface AuditEvent extends SecurityEvent {
  session: string
  user: string
  command?: string
  resource?: string
  duration?: number
}
