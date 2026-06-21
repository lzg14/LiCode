import { Hono } from 'hono'
import { randomUUID } from 'crypto'
import { CoreLoop, type LoopContext } from '../../core/loop'
import { sseManager } from '../sse'
import type { Context } from 'hono'

interface Session {
  id: string
  title: string
  status: 'active' | 'completed' | 'error'
  messages: Message[]
  createdAt: number
  updatedAt: number
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

const sessions = new Map<string, Session>()

const sessionRoutes = new Hono()

sessionRoutes.get('/', (c: Context) => {
  const list = Array.from(sessions.values())
    .sort((a, b) => b.updatedAt - a.updatedAt)
  return c.json({ sessions: list })
})

sessionRoutes.post('/', async (c: Context) => {
  const body = (await c.req.json()) as { title?: string }
  const id = randomUUID()
  const session: Session = {
    id,
    title: body.title || '新会话',
    status: 'active',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  sessions.set(id, session)
  sseManager.broadcast('session:created', { sessionId: id })
  return c.json({ session }, 201)
})

sessionRoutes.get('/:id', (c: Context) => {
  const id = c.req.param('id') ?? ''
  const session = sessions.get(id)
  if (!session) return c.json({ error: '会话不存在' }, 404)
  return c.json({ session })
})

sessionRoutes.post('/:id/message', async (c: Context) => {
  const id = c.req.param('id') ?? ''
  const session = sessions.get(id)
  if (!session) return c.json({ error: '会话不存在' }, 404)

  const body = (await c.req.json()) as { content: string }
  if (!body.content) return c.json({ error: '消息内容不能为空' }, 400)

  const userMessage: Message = {
    id: randomUUID(),
    role: 'user',
    content: body.content,
    timestamp: Date.now(),
  }
  session.messages.push(userMessage)
  session.updatedAt = Date.now()
  sseManager.broadcast('message:received', { sessionId: id, message: userMessage })

  const ctx: LoopContext = {
    sessionId: id,
    userInput: body.content,
    effortLevel: 1,
    phase: 'EXECUTE',
    cwd: process.cwd(),
    onStreamText: (text: string) => {
      sseManager.broadcast('stream:text', { sessionId: id, text })
    },
    onPhaseChange: (phase: string) => {
      sseManager.broadcast('phase:change', { sessionId: id, phase })
    },
  }

  let aiResponse: string
  try {
    const loop = new CoreLoop({
      llm: { provider: 'local', model: '' },
      security: { commandWhitelist: [], allowedPaths: [], deniedPaths: [] },
      memory: { path: '', retentionDays: 30 },
      subagent: { maxConcurrent: 3, maxDepth: 1, timeoutMs: 900000, blockedTools: [] },
    })
    aiResponse = await loop.run(ctx)
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : '未知错误'
    session.status = 'error'
    return c.json({ error: errorMsg }, 500)
  }

  const assistantMessage: Message = {
    id: randomUUID(),
    role: 'assistant',
    content: aiResponse,
    timestamp: Date.now(),
  }
  session.messages.push(assistantMessage)
  session.updatedAt = Date.now()
  sseManager.broadcast('message:completed', { sessionId: id, message: assistantMessage })

  return c.json({ message: assistantMessage })
})

sessionRoutes.delete('/:id', (c: Context) => {
  const id = c.req.param('id') ?? ''
  if (!sessions.has(id)) return c.json({ error: '会话不存在' }, 404)
  sessions.delete(id)
  sseManager.broadcast('session:deleted', { sessionId: id })
  return c.json({ success: true })
})

export { sessionRoutes }
export type { Session, Message }
