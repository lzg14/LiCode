export interface SSEClient {
  id: string
  send: (event: string, data: unknown) => void
  close: () => void
}

export interface SSEEvent {
  event: string
  data: unknown
  id?: string
}

export class SSEManager {
  private clients: Map<string, SSEClient> = new Map()
  private eventHistory: SSEEvent[] = []
  private maxHistory = 100

  constructor() {}

  createClient(id: string, sendFn: (event: string, data: unknown) => void, closeFn: () => void): SSEClient {
    const client: SSEClient = {
      id,
      send: sendFn,
      close: closeFn,
    }
    this.clients.set(id, client)
    return client
  }

  removeClient(id: string): void {
    this.clients.delete(id)
  }

  broadcast(event: string, data: unknown, clientId?: string): void {
    const sseEvent: SSEEvent = { event, data, id: Date.now().toString() }
    this.eventHistory.push(sseEvent)
    if (this.eventHistory.length > this.maxHistory) {
      this.eventHistory.shift()
    }

    for (const [id, client] of this.clients) {
      if (clientId && id === clientId) continue
      try {
        client.send(event, data)
      } catch {
        this.clients.delete(id)
      }
    }
  }

  sendTo(clientId: string, event: string, data: unknown): boolean {
    const client = this.clients.get(clientId)
    if (!client) return false
    try {
      client.send(event, data)
      return true
    } catch {
      this.clients.delete(clientId)
      return false
    }
  }

  getClientCount(): number {
    return this.clients.size
  }

  getEventHistory(limit?: number): SSEEvent[] {
    const count = limit ?? this.eventHistory.length
    return this.eventHistory.slice(-count)
  }
}

export const sseManager = new SSEManager()
