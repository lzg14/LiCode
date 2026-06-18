import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'fs'
import { dirname, join } from 'path'
import { homedir } from 'os'
import type { AuditEvent, EventType } from './events'

/**
 * 审计日志系统 - 操作记录、费用追踪、安全事件
 */

const AUDIT_BASE = join(homedir(), '.licode', 'logs')

export class AuditLogger {
  private logDir: string

  constructor(logDir: string = AUDIT_BASE) {
    this.logDir = logDir
    this.init()
  }

  init(): void {
    mkdirSync(this.logDir, { recursive: true })
  }

  /**
   * 记录审计事件
   */
  log(event: AuditEvent): void {
    const date = new Date().toISOString().split('T')[0]
    const file = join(this.logDir, `audit-${date}.jsonl`)

    const dir = dirname(file)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    const line = JSON.stringify(event) + '\n'
    appendFileSync(file, line, { encoding: 'utf-8' })
  }

  /**
   * 记录安全事件
   */
  logSecurity(type: EventType, details: Record<string, unknown>, action: 'blocked' | 'warned' | 'allowed_with_log' = 'allowed_with_log'): void {
    this.log({
      type,
      timestamp: Date.now(),
      details,
      action,
      session: 'current',
      user: 'local',
    })
  }

  /**
   * 记录工具调用
   */
  logToolCall(toolName: string, input: unknown, output: unknown, duration: number): void {
    this.log({
      type: 'skill_executed',
      timestamp: Date.now(),
      details: {
        tool: toolName,
        input: JSON.stringify(input).slice(0, 1000),
        output: JSON.stringify(output).slice(0, 1000),
        duration,
      },
      action: 'allowed_with_log',
      session: 'current',
      user: 'local',
      command: toolName,
      duration,
    })
  }

  /**
   * 记录 LLM 调用
   */
  logLLMCall(model: string, inputTokens: number, outputTokens: number, duration: number): void {
    this.log({
      type: 'skill_executed',
      timestamp: Date.now(),
      details: {
        model,
        inputTokens,
        outputTokens,
        duration,
        cost: this.estimateCost(model, inputTokens, outputTokens),
      },
      action: 'allowed_with_log',
      session: 'current',
      user: 'local',
      duration,
    })
  }

  /**
   * 记录会话开始
   */
  logSessionStart(sessionId: string): void {
    this.log({
      type: 'agent_spawned',
      timestamp: Date.now(),
      details: { sessionId },
      action: 'allowed_with_log',
      session: sessionId,
      user: 'local',
    })
  }

  /**
   * 记录会话结束
   */
  logSessionEnd(sessionId: string, messageCount: number): void {
    this.log({
      type: 'agent_terminated',
      timestamp: Date.now(),
      details: { sessionId, messageCount },
      action: 'allowed_with_log',
      session: sessionId,
      user: 'local',
    })
  }

  /**
   * 估算费用（美元）
   */
  private estimateCost(model: string, inputTokens: number, outputTokens: number): number {
    // 简化的费用估算
    const pricing: Record<string, { input: number; output: number }> = {
      'claude-sonnet-4-20250514': { input: 0.003, output: 0.015 },
      'claude-haiku': { input: 0.00025, output: 0.00125 },
      'deepseek-v4-flash': { input: 0.0001, output: 0.0002 },
    }

    const rates = pricing[model] || pricing['deepseek-v4-flash']
    return (inputTokens * rates.input + outputTokens * rates.output) / 1000
  }

  /**
   * 查询日志
   */
  query(date?: string, type?: EventType): AuditEvent[] {
    const targetDate = date || new Date().toISOString().split('T')[0]
    const file = join(this.logDir, `audit-${targetDate}.jsonl`)

    if (!existsSync(file)) return []

    const content = readFileSync(file, 'utf-8')
    const lines = content.trim().split('\n').filter(Boolean)

    return lines
      .map(line => {
        try {
          return JSON.parse(line) as AuditEvent
        } catch {
          return null
        }
      })
      .filter((e): e is AuditEvent => e !== null && (!type || e.type === type))
  }

  /**
   * 获取统计信息
   */
  getStats(date?: string): {
    totalEvents: number
    securityEvents: number
    toolCalls: number
    llmCalls: number
    estimatedCost: number
  } {
    const events = this.query(date)

    return {
      totalEvents: events.length,
      securityEvents: events.filter(e => e.type.includes('blocked') || e.type.includes('violation')).length,
      toolCalls: events.filter(e => e.type === 'skill_executed' && e.command).length,
      llmCalls: events.filter(e => e.type === 'skill_executed' && e.details.model).length,
      estimatedCost: events.reduce((sum, e) => sum + ((e.details.cost as number) || 0), 0),
    }
  }
}

export const auditLogger = new AuditLogger()
