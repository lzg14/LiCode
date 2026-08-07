/**
 * message.tsx - 消息状态管理
 *
 * 从 loop.tsx 抽取：
 * - messages: 消息列表
 * - addMessage / updateMessage / clearMessages
 * - 消息历史恢复
 */

import { type Accessor, createSignal } from "solid-js"

/** 消息结构 */
export interface Message {
  id: string
  role: "user" | "assistant" | "system" | "tool"
  content: string
  timestamp: number
  toolName?: string
  toolArgs?: Record<string, unknown>
  toolStatus?: "pending" | "running" | "completed" | "error"
  toolBatch?: number
  duration?: number
  /** 工具执行产生的 diff */
  diff?: string
  /** 队列中等待发送的 user 消息 */
  queued?: boolean
  /** 附带的图片列表（base64 + mimeType），用于 multimodal 消息 */
  images?: Array<{ base64: string; mimeType: string }>
  /** 是否为压缩摘要消息（渲染为 markdown） */
  compaction?: boolean
}

export type AddMessageInput = {
  role: Message["role"]
  content: string
  id?: string
  toolName?: string
  toolArgs?: Record<string, unknown>
  toolStatus?: "pending" | "running" | "completed" | "error"
  toolBatch?: number
  duration?: number
  diff?: string
  queued?: boolean
  images?: Message["images"]
  compaction?: boolean
}

export interface MessageState {
  /** 消息列表 */
  messages: Accessor<Message[]>
  /** 添加消息 */
  addMessage: (input: AddMessageInput) => Message
  /** 更新消息 */
  updateMessage: (id: string, patch: Partial<Message>) => void
  /** 清空消息 */
  clearMessages: () => void
  /** 设置消息列表（用于恢复历史） */
  setMessages: (messages: Message[] | ((prev: Message[]) => Message[])) => void
}

export function createMessageState(): MessageState {
  const [messages, setMessages] = createSignal<Message[]>([])

  const addMessage = (input: AddMessageInput): Message => {
    const id = input.id ?? crypto.randomUUID()
    const msg: Message = {
      id,
      role: input.role,
      content: input.content,
      timestamp: Date.now(),
      toolName: input.toolName,
      toolArgs: input.toolArgs,
      toolStatus: input.toolStatus,
      duration: input.duration,
      queued: input.queued,
      images: input.images,
      compaction: input.compaction,
    }
    setMessages((prev) => [...prev, msg])
    return msg
  }

  const updateMessage = (id: string, patch: Partial<Message>) => {
    setMessages((prev) => prev.map(m => m.id === id ? { ...m, ...patch } : m))
  }

  const clearMessages = () => {
    setMessages([])
  }

  return {
    messages,
    addMessage,
    updateMessage,
    clearMessages,
    setMessages,
  }
}

export type MessageStateReturn = ReturnType<typeof createMessageState>
