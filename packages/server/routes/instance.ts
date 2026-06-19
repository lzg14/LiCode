import { Hono } from 'hono'
import { randomUUID } from 'crypto'
import type { Context } from 'hono'

interface InstanceInfo {
  id: string
  version: string
  uptime: number
  startedAt: number
  config: {
    llmProvider: string
    model: string
    maxConcurrent: number
  }
}

const instanceId = randomUUID()
const startedAt = Date.now()

const instanceRoutes = new Hono()

instanceRoutes.get('/', (c: Context) => {
  const info: InstanceInfo = {
    id: instanceId,
    version: '0.1.0',
    uptime: Date.now() - startedAt,
    startedAt,
    config: {
      llmProvider: 'local',
      model: '',
      maxConcurrent: 3,
    },
  }
  return c.json({ instance: info })
})

instanceRoutes.get('/status', (c: Context) => {
  return c.json({
    status: 'running',
    uptime: Date.now() - startedAt,
    memory: process.memoryUsage(),
  })
})

export { instanceRoutes }
