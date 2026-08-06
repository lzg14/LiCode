/**
 * loop-input.tsx - 输入队列状态管理
 * 
 * 从 loop.tsx 抽取：
 * - inputQueue: 用户消息队列
 * - pendingCount: 待处理消息数
 * - abortController: 取消控制器
 * - addInputToQueue / dequeueInput / abort
 */

import { createSignal } from "solid-js"

export interface InputQueueItem {
  text: string
  clipboardImages?: Array<{ base64: string; mimeType: string }>
}

export interface InputState {
  /** 消息队列 */
  inputQueue: InputQueueItem[]
  /** 是否正在处理 */
  isProcessing: boolean
  /** 待处理数量 */
  pendingCount: number
  /** 中止控制器 */
  abortController: AbortController | null
}

export function createInputState() {
  const [inputQueue, setInputQueue] = createSignal<InputQueueItem[]>([])
  const [isProcessing, setIsProcessing] = createSignal(false)
  const [pendingCount, setPendingCount] = createSignal(0)
  let abortController: AbortController | null = null

  const addInputToQueue = (text: string, clipboardImages?: Array<{ base64: string; mimeType: string }>) => {
    setInputQueue(prev => [...prev, { text, clipboardImages }])
    setPendingCount(prev => prev + 1)
  }

  const dequeueInput = (): InputQueueItem | undefined => {
    const queue = inputQueue()
    if (queue.length === 0) return undefined
    const item = queue[0]
    setInputQueue(prev => prev.slice(1))
    setPendingCount(prev => Math.max(0, prev - 1))
    return item
  }

  const abort = () => {
    if (abortController) {
      abortController.abort()
      abortController = null
    }
    setIsProcessing(false)
    setInputQueue([])
    setPendingCount(0)
  }

  const createAbortController = (): AbortController => {
    abortController = new AbortController()
    return abortController
  }

  const getAbortSignal = (): AbortSignal | undefined => {
    return abortController?.signal
  }

  return {
    inputQueue,
    isProcessing,
    pendingCount,
    setIsProcessing,
    addInputToQueue,
    dequeueInput,
    abort,
    createAbortController,
    getAbortSignal,
  }
}

export type InputStateReturn = ReturnType<typeof createInputState>
