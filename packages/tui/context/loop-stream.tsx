/**
 * loop-stream.tsx - 流式输出状态管理
 * 
 * 从 loop.tsx 抽取：
 * - streamingSegments: 流式输出片段
 * - pendingText: 待处理文本
 * - streamMode: 流式模式
 * - onStreamText / onIntermediateText
 */

import { createSignal } from "solid-js"
import { createStreamAccumulator, type Segment } from "../util/stream-accumulator"

export interface StreamState {
  /** 流式输出片段 */
  streamingSegments: Segment[]
  /** 待处理文本（思考中） */
  pendingText: string
  /** 流式模式 */
  streamMode: 'text' | 'in-thinking' | 'in-system-reminder'
}

export function createStreamState() {
  const [streamingSegments, setStreamingSegments] = createSignal<Segment[]>([])
  const [pendingText, setPendingText] = createSignal("")
  const [streamMode, setStreamMode] = createSignal<'text' | 'in-thinking' | 'in-system-reminder'>('text')
  
  const accumulator = createStreamAccumulator()

  const onStreamText = (text: string) => {
    // 检测是否在 thinking 或 system-reminder 中
    if (text.includes("<thinking>") && !text.includes("</thinking>")) {
      setStreamMode('in-thinking')
    } else if (text.includes("</thinking>")) {
      setStreamMode('text')
    } else if (text.includes("[系统提醒]") || text.includes("[System Reminder]")) {
      setStreamMode('in-system-reminder')
    } else if (streamMode() === 'in-system-reminder' && !text.includes("提醒")) {
      setStreamMode('text')
    }
    
    const segment = accumulator.append(text)
    setStreamingSegments(accumulator.getSegments())
  }

  const onIntermediateText = (text: string) => {
    setPendingText(text)
  }

  const clearStream = () => {
    accumulator.clear()
    setStreamingSegments([])
    setPendingText("")
    setStreamMode('text')
  }

  const resetStream = () => {
    accumulator.reset()
    setStreamingSegments([])
    setPendingText("")
    setStreamMode('text')
  }

  return {
    streamingSegments,
    pendingText,
    streamMode,
    onStreamText,
    onIntermediateText,
    clearStream,
    resetStream,
  }
}

export type StreamStateReturn = ReturnType<typeof createStreamState>
