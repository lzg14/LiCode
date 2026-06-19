import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { sessionRoutes } from './routes/session'
import { instanceRoutes } from './routes/instance'
import { sseManager } from './sse'
import { randomUUID } from 'crypto'
import type { Context } from 'hono'

const app = new Hono()

app.use('*', cors())

app.route('/api/session', sessionRoutes)
app.route('/api/instance', instanceRoutes)

app.get('/api/sse', (c: Context) => {
  const clientId = randomUUID()

  const headers = new Headers({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()

      const send = (event: string, data: unknown) => {
        try {
          const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
          controller.enqueue(encoder.encode(payload))
        } catch {
          sseManager.removeClient(clientId)
        }
      }

      const closeFn = () => {
        sseManager.removeClient(clientId)
        try { controller.close() } catch { /* already closed */ }
      }

      sseManager.createClient(clientId, send, closeFn)

      send('connected', { clientId })

      const heartbeat = setInterval(() => {
        send('heartbeat', { timestamp: Date.now() })
      }, 30000)

      const originalClose = controller.close.bind(controller)
      controller.close = () => {
        clearInterval(heartbeat)
        sseManager.removeClient(clientId)
        originalClose()
      }
    },
  })

  return new Response(stream, { headers })
})

app.get('/api/health', (c: Context) => {
  return c.json({ status: 'ok', timestamp: Date.now() })
})

export function createServer(port = 3000) {
  return {
    fetch: app.fetch,
    port,
    start: async () => {
      console.log(`Licode server running on http://localhost:${port}`)
    },
  }
}

export { app }
