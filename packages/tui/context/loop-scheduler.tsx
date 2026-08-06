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
  const [scheduler] = createSignal(new Scheduler())
  const [hasTasks, setHasTasks] = createSignal(false)
  const [tasks, setTasks] = createSignal<ScheduledTask[]>([])

  const updateTasks = () => {
    const s = scheduler()
    setHasTasks(s.hasTasks())
    setTasks(s.list())
  }

  const addLoop = (intervalMs: number, prompt: string) => {
    scheduler().add(intervalMs, prompt)
    updateTasks()
  }

  const stopLoops = () => {
    scheduler().stopAll()
    updateTasks()
  }

  const stopLoop = (id: string) => {
    scheduler().stop(id)
    updateTasks()
  }

  const listLoops = (): ScheduledTask[] => {
    return scheduler().list()
  }

  return {
    scheduler,
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
