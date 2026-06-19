import type { AgentOutcome, Task, TaskEvent, TaskStatus } from './types'

const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending: ['in_progress', 'abandoned'],
  in_progress: ['blocked', 'done', 'abandoned'],
  blocked: ['in_progress', 'abandoned'],
  done: [],
  abandoned: [],
}

export class TaskManager {
  private tasks = new Map<string, Task>()

  create(id: string, summary: string, parentId?: string): Task {
    if (this.tasks.has(id)) {
      throw new Error(`Task ${id} already exists`)
    }

    const now = Date.now()
    const task: Task = {
      id,
      summary,
      parentId,
      status: 'pending',
      events: [],
      createdAt: now,
      updatedAt: now,
    }

    this.recordEvent(task, 'created', { detail: summary })
    this.tasks.set(id, task)
    return task
  }

  start(id: string, eventSummary?: string): Task {
    const task = this.getRequired(id)
    this.transition(task, 'in_progress', eventSummary)
    return task
  }

  block(id: string, reason: string): Task {
    const task = this.getRequired(id)
    this.transition(task, 'blocked', reason)
    return task
  }

  unblock(id: string, eventSummary?: string): Task {
    const task = this.getRequired(id)
    this.transition(task, 'in_progress', eventSummary)
    return task
  }

  complete(id: string, result?: AgentOutcome): Task {
    const task = this.getRequired(id)
    this.transition(task, 'done')
    if (result) {
      task.result = result
    }
    task.completedAt = Date.now()
    return task
  }

  fail(id: string, error: string): Task {
    const task = this.getRequired(id)
    this.transition(task, 'done')
    task.result = { status: 'failed', error }
    task.completedAt = Date.now()
    return task
  }

  abandon(id: string, reason?: string): Task {
    const task = this.getRequired(id)
    this.transition(task, 'abandoned', reason)
    task.completedAt = Date.now()
    return task
  }

  rename(id: string, newSummary: string): Task {
    const task = this.getRequired(id)
    const oldSummary = task.summary
    task.summary = newSummary
    task.updatedAt = Date.now()
    this.recordEvent(task, 'renamed', { detail: `${oldSummary} → ${newSummary}` })
    return task
  }

  get(id: string): Task | undefined {
    return this.tasks.get(id)
  }

  private getRequired(id: string): Task {
    const task = this.tasks.get(id)
    if (!task) throw new Error(`Task ${id} not found`)
    return task
  }

  list(options: { status?: TaskStatus; includeArchived?: boolean } = {}): Task[] {
    let tasks = Array.from(this.tasks.values())

    if (options.status) {
      tasks = tasks.filter(t => t.status === options.status)
    }

    if (!options.includeArchived) {
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
      tasks = tasks.filter(t =>
        t.status !== 'done' && t.status !== 'abandoned' ||
        (t.completedAt ?? 0) > cutoff
      )
    }

    return tasks
  }

  getChildren(parentId: string): Task[] {
    return Array.from(this.tasks.values()).filter(t => t.parentId === parentId)
  }

  getHistory(id: string): TaskEvent[] {
    const task = this.tasks.get(id)
    return task ? [...task.events] : []
  }

  private transition(task: Task, newStatus: TaskStatus, detail?: string): void {
    const allowed = VALID_TRANSITIONS[task.status]
    if (!allowed.includes(newStatus)) {
      throw new Error(
        `Invalid transition: ${task.status} → ${newStatus} for task ${task.id}`
      )
    }

    const previousStatus = task.status
    task.status = newStatus
    task.updatedAt = Date.now()

    this.recordEvent(task, this.statusToEvent(newStatus), {
      detail,
      previousStatus,
      newStatus,
    })
  }

  private statusToEvent(status: TaskStatus): TaskEvent['type'] {
    const map: Record<TaskStatus, TaskEvent['type']> = {
      pending: 'created',
      in_progress: 'started',
      blocked: 'blocked',
      done: 'completed',
      abandoned: 'abandoned',
    }
    return map[status]
  }

  private recordEvent(
    task: Task,
    type: TaskEvent['type'],
    opts: { detail?: string; previousStatus?: TaskStatus; newStatus?: TaskStatus } = {},
  ): void {
    const event: TaskEvent = {
      taskId: task.id,
      type,
      timestamp: Date.now(),
      detail: opts.detail,
      previousStatus: opts.previousStatus,
      newStatus: opts.newStatus,
    }
    task.events.push(event)
  }
}

export const taskManager = new TaskManager()
