import { appendFileSync, existsSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import type { AuditEvent } from './events'

export class AuditLogger {
  private logDir: string

  constructor(logDir: string) {
    this.logDir = logDir
  }

  init(): void {
    mkdirSync(this.logDir, { recursive: true })
  }

  log(event: AuditEvent): void {
    const date = new Date().toISOString().split('T')[0]
    const file = join(this.logDir, `audit-${date}.jsonl`)

    // 确保目录存在
    const dir = dirname(file)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    const line = JSON.stringify(event) + '\n'
    appendFileSync(file, line, { encoding: 'utf-8' })
  }

  logSecurity(event: Omit<AuditEvent, 'session' | 'user'> & { session?: string; user?: string }): void {
    this.log({
      session: event.session ?? 'unknown',
      user: event.user ?? 'unknown',
      ...event,
    } as AuditEvent)
  }
}
