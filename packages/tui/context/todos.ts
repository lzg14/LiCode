import { createSignal } from "solid-js"

export interface Todo {
  id: string
  content: string
  status: string
  activeForm?: string
}

// 全局 todo 状态 — sidebar.tsx 读取，builtin.ts 写入
export const [todos, setTodos] = createSignal<Todo[]>([])
