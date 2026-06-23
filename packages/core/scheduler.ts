export interface ScheduledTask {
  id: string
  prompt: string
  intervalMs: number
  timerId: ReturnType<typeof setTimeout>
  createdAt: number
  runCount: number
}

export interface SchedulerCallbacks {
  onTrigger: (prompt: string) => Promise<void>
  onLog: (msg: string) => void
}

export class Scheduler {
  private tasks = new Map<string, ScheduledTask>()
  private callbacks: SchedulerCallbacks

  constructor(callbacks: SchedulerCallbacks) {
    this.callbacks = callbacks
  }

  parseInterval(input: string): number | null {
    const match = input.match(/^(\d+)(s|m|h|d)$/)
    if (!match) return null
    const [, num, unit] = match
    const n = parseInt(num, 10)
    switch (unit) {
      case 's': return n * 1000
      case 'm': return n * 60 * 1000
      case 'h': return n * 60 * 60 * 1000
      case 'd': return n * 24 * 60 * 60 * 1000
      default: return null
    }
  }

  create(intervalMs: number, prompt: string): string {
    const id = `loop_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`

    const tick = async () => {
      const task = this.tasks.get(id)
      if (!task) return
      task.runCount++
      this.callbacks.onLog(`[loop] 第 ${task.runCount} 次执行: ${prompt}`)
      try {
        await this.callbacks.onTrigger(prompt)
      } catch (e) {
        this.callbacks.onLog(`[loop] 执行出错: ${e instanceof Error ? e.message : String(e)}`)
      }
      const newTimerId = setTimeout(tick, intervalMs)
      task.timerId = newTimerId
    }

    const timerId = setTimeout(tick, intervalMs)
    const task: ScheduledTask = {
      id, prompt, intervalMs, timerId,
      createdAt: Date.now(), runCount: 0,
    }
    this.tasks.set(id, task)
    return id
  }

  delete(id: string): boolean {
    const task = this.tasks.get(id)
    if (!task) return false
    clearTimeout(task.timerId)
    this.tasks.delete(id)
    return true
  }

  deleteAll(): number {
    let count = 0
    for (const [id] of this.tasks) {
      this.delete(id)
      count++
    }
    return count
  }

  list(): Omit<ScheduledTask, 'timerId'>[] {
    return Array.from(this.tasks.values()).map(t => {
      const { timerId, ...rest } = t
      return rest
    })
  }

  hasTasks(): boolean {
    return this.tasks.size > 0
  }
}
