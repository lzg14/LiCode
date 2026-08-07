/**
 * loop-scheduler.tsx - 定时任务状态管理
 * 
 * 从 loop.tsx 抽取：
 * - scheduler: 定时任务调度器
 * - addLoop / stopLoops / listLoops
 */

import { createSignal } from "solid-js"
import { Scheduler, type ScheduledTask } from "../../core/scheduler"

export interface SchedulerState {
  /** 是否有定时任务 */
  hasTasks: boolean
  /** 任务列表 */
  tasks: ScheduledTask[]
}

export function createSchedulerState() {
  const [hasTasks, setHasTasks] = createSignal(false)
  const [tasks, setTasks] = createSignal<Omit<ScheduledTask, "timerId">[]>([])

  // Scheduler 构造函数需要 callbacks
  let scheduler: Scheduler | null = null

  const setScheduler = (s: Scheduler) => {
    scheduler = s
  }

  const updateTasks = () => {
    if (!scheduler) return
    setHasTasks(scheduler.hasTasks())
    setTasks(scheduler.list())
  }

  const addLoop = (intervalMs: number, prompt: string) => {
    if (!scheduler) return
    scheduler.create(intervalMs, prompt)
    updateTasks()
  }

  const stopLoops = () => {
    if (!scheduler) return
    scheduler.deleteAll()
    updateTasks()
  }

  const stopLoop = (id: string) => {
    if (!scheduler) return
    scheduler.delete(id)
    updateTasks()
  }

  const listLoops = () => {
    return scheduler ? scheduler.list() : []
  }

  return {
    setScheduler,
    hasTasks,
    tasks,
    addLoop,
    stopLoops,
    stopLoop,
    listLoops,
    updateTasks,
  }
}

export type SchedulerStateReturn = ReturnType<typeof createSchedulerState>
