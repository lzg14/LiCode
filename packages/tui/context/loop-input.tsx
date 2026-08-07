/**
 * loop-input.tsx - 输入队列状态管理
 *
 * 从 loop.tsx 抽取：
 * - inputQueue: 用户消息队列
 * - pendingCount: 待处理消息数
 * - enqueue / dequeue / clearQueue / queueLength
 */

import { createSignal } from "solid-js"

export interface InputQueueItem {
  id: string
  text: string
}

export function createInputState() {
  const [inputQueue, setInputQueue] = createSignal<InputQueueItem[]>([])
  const [pendingCount, setPendingCount] = createSignal(0)

  const enqueue = (item: Omit<InputQueueItem, 'id'> & { id?: string }) => {
    const id = item.id ?? `queued_${Date.now()}`
    setInputQueue(prev => [...prev, { id, text: item.text }])
    setPendingCount(prev => prev + 1)
  }

  const dequeue = (): InputQueueItem | undefined => {
    const queue = inputQueue()
    if (queue.length === 0) return undefined
    const item = queue[0]
    setInputQueue(prev => prev.slice(1))
    setPendingCount(prev => Math.max(0, prev - 1))
    return item
  }

  const clearQueue = () => {
    setInputQueue([])
    setPendingCount(0)
  }

  const queueLength = () => inputQueue().length

  return {
    pendingCount,
    enqueue,
    dequeue,
    clearQueue,
    queueLength,
  }
}

export type InputStateReturn = ReturnType<typeof createInputState>
