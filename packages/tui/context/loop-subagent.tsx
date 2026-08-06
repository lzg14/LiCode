/**
 * loop-subagent.tsx - 子 Agent 状态管理
 * 
 * 从 loop.tsx 抽取：
 * - subagentStatuses: 子 agent 状态
 * - subagentOpen: 是否显示子 agent 面板
 */

import { createSignal } from "solid-js"

export interface SubagentStatus {
  id: string
  task: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  result?: string
  error?: string
  startTime: number
  endTime?: number
}

export function createSubagentState() {
  const [subagentStatuses, setSubagentStatuses] = createSignal<SubagentStatus[]>([])
  const [subagentOpen, setSubagentOpen] = createSignal(false)

  const addSubagent = (id: string, task: string) => {
    setSubagentStatuses(prev => [
      ...prev,
      {
        id,
        task,
        status: 'running',
        startTime: Date.now(),
      },
    ])
  }

  const updateSubagent = (id: string, update: Partial<SubagentStatus>) => {
    setSubagentStatuses(prev =>
      prev.map(s => (s.id === id ? { ...s, ...update } : s))
    )
  }

  const removeSubagent = (id: string) => {
    setSubagentStatuses(prev => prev.filter(s => s.id !== id))
  }

  const clearSubagents = () => {
    setSubagentStatuses([])
  }

  return {
    subagentStatuses,
    subagentOpen,
    setSubagentOpen,
    addSubagent,
    updateSubagent,
    removeSubagent,
    clearSubagents,
  }
}

export type SubagentStateReturn = ReturnType<typeof createSubagentState>
