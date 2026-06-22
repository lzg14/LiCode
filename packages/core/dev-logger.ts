import { appendFileSync, existsSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { homedir } from 'os'

/**
 * 开发日志系统 - 记录所有异常、LLM请求响应、调试信息
 */

// ===== 敏感字段 redact =====

const REDACT_KEYS = [
  'apikey', 'api_key', 'api-key',
  'token', 'access_token', 'refresh_token',
  'password', 'passwd', 'pwd',
  'secret', 'client_secret',
  'authorization', 'auth',
]

const INLINE_PATTERNS: RegExp[] = [
  /sk-ant-api[0-9]{2}-[A-Za-z0-9_\-]{20,}/g,  // Anthropic
  /sk-proj-[A-Za-z0-9_\-]{20,}/g,                // OpenAI 新
  /sk-[A-Za-z0-9]{20,}/g,                        // OpenAI 旧 / DeepSeek / MiniMax
  /ghp_[A-Za-z0-9]{20,}/g,                         // GitHub PAT
  /xox[abpr]-[0-9]+-[0-9]+-[A-Za-z0-9]+/g,      // Slack
  /Bearer\s+[A-Za-z0-9_\-\.]{20,}/g,             // Bearer token
  /ANTHROPIC_API_KEY=[^\s]{10,}/g,                // env-style
  /OPENAI_API_KEY=[^\s]{10,}/g,
]

export function redact(obj: unknown): unknown {
  if (obj == null) return obj
  if (typeof obj === 'string') {
    return INLINE_PATTERNS.reduce((s, p) => s.replace(p, '***REDACTED***'), obj)
  }
  if (Array.isArray(obj)) return obj.map(redact)
  if (typeof obj === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) {
      if (REDACT_KEYS.some(rk => k.toLowerCase().includes(rk))) {
        out[k] = '***REDACTED***'
      } else {
        out[k] = redact(v)
      }
    }
    return out
  }
  return obj
}

const DEV_LOG_DIR = join(homedir(), '.licode', 'logs', 'dev')

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export class DevLogger {
  private logDir: string
  private level: LogLevel
  private sessionId: string
  private logFile: string

  constructor(level: LogLevel = LogLevel.DEBUG) {
    this.level = level
    this.sessionId = new Date().toISOString().replace(/[:.]/g, '-')
    this.logDir = DEV_LOG_DIR
    this.logFile = join(this.logDir, `dev-${this.sessionId}.log`)
    this.init()
  }

  private init(): void {
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true })
    }
  }

  private formatMessage(level: string, category: string, msg: string, data?: unknown): string {
    const timestamp = new Date().toISOString()
    let line = `[${timestamp}] [${level}] [${category}] ${msg}`
    if (data !== undefined) {
      if (data instanceof Error) {
        line += `\n  Error: ${data.message}\n  Stack: ${data.stack}`
      } else if (typeof data === 'object') {
        line += `\n  Data: ${JSON.stringify(data, null, 2)}`
      } else {
        line += ` ${String(data)}`
      }
    }
    return line
  }

  private write(level: string, category: string, msg: string, data?: unknown): void {
    const line = this.formatMessage(level, category, msg, data) + '\n'
    console.log(line.trim())
    try {
      appendFileSync(this.logFile, line, { encoding: 'utf-8' })
    } catch (e) {
      console.error('[DevLogger] Failed to write log:', e)
    }
  }

  debug(category: string, msg: string, data?: unknown): void {
    if (this.level <= LogLevel.DEBUG) {
      this.write('DEBUG', category, msg, data)
    }
  }

  info(category: string, msg: string, data?: unknown): void {
    if (this.level <= LogLevel.INFO) {
      this.write('INFO', category, msg, data)
    }
  }

  warn(category: string, msg: string, data?: unknown): void {
    if (this.level <= LogLevel.WARN) {
      this.write('WARN', category, msg, data)
    }
  }

  error(category: string, msg: string, error?: unknown): void {
    if (this.level <= LogLevel.ERROR) {
      this.write('ERROR', category, msg, error)
    }
  }

  // LLM 请求日志
  logLLMRequest(model: string, provider: string, messages: unknown[], tools?: unknown): void {
    this.info('LLM', `>>> LLM Request | model=${model} | provider=${provider}`, {
      messageCount: messages.length,
      tools: tools ? 'yes' : 'no',
      messages: messages.map((m: any) => ({
        role: m.role,
        content: redact(typeof m.content === 'string' ? m.content.slice(0, 200) + '...' : '[complex]'),
      })),
    })
  }

  // LLM 响应日志
  logLLMResponse(response: unknown, duration: number): void {
    this.info('LLM', `<<< LLM Response | duration=${duration}ms`, redact(response))
  }

  // LLM 流式片段日志
  logLLMChunk(chunk: unknown, isComplete: boolean): void {
    this.debug('LLM', `... LLM chunk | complete=${isComplete}`, redact(chunk))
  }

  // 工具调用日志
  logToolCall(toolName: string, args: unknown, result?: unknown, duration?: number): void {
    const msg = duration !== undefined
      ? `>>> Tool Call | ${toolName} | ${duration}ms`
      : `>>> Tool Call | ${toolName}`
    this.info('TOOL', msg, { args: redact(args), result: redact(result) })
  }

  // 异常日志（详细）
  logException(context: string, error: unknown, extra?: unknown): void {
    this.error('EXCEPTION', `Exception in ${context}`, { error, ...(extra && typeof extra === 'object' ? extra : extra != null ? { detail: extra } : {}) })
  }

  // Session 日志
  logSession(action: string, data?: unknown): void {
    this.info('SESSION', action, data)
  }

  getLogFile(): string {
    return this.logFile
  }
}

export const devLogger = new DevLogger(LogLevel.DEBUG)

// 全局异常处理器
export function setupGlobalErrorHandlers(logger: DevLogger): void {
  process.on('uncaughtException', (error: Error) => {
    logger.logException('uncaughtException', error)
    // 只在致命错误时退出，streaming 错误不应该导致进程退出
    if (error.message?.includes('FATAL') || error.message?.includes('ENOENT')) {
      process.exit(1)
    }
  })

  process.on('unhandledRejection', (reason: unknown) => {
    logger.logException('unhandledRejection', reason)
  })
}
