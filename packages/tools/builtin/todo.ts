import { z } from 'zod'
import type { ToolRegistry } from '../registry'
import type { Todo } from '../../tui/context/todos'

function registerTodoWrite(registry: ToolRegistry): void {
  registry.register({
    name: 'todo_write',
    description: '写入/更新 todo 列表。复杂任务（>3步）请先写 todo 追踪进度。',
    inputSchema: z.object({
      items: z.array(z.object({
        id: z.string().describe('唯一标识'),
        content: z.string().describe('任务描述'),
        status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).describe('状态'),
        activeForm: z.string().optional().describe('当前正在做什么'),
      })).describe('todo 列表'),
    }),
    handler: async ({ items }: { items: Array<{ id: string; content: string; status: 'pending' | 'in_progress' | 'completed' | 'cancelled'; activeForm?: string }> }) => {
      const ids = items.map(i => i.id)
      if (new Set(ids).size !== ids.length) {
        return { success: false, error: '存在重复的 todo id' }
      }
      const { setTodos } = await import('../../tui/context/todos')
      setTodos(items)
      return { success: true, output: `已更新 ${items.length} 个 todo` }
    },
  })
}

function registerTodoRead(registry: ToolRegistry): void {
  registry.register({
    name: 'todo_read',
    description: '读取当前 todo 列表。',
    inputSchema: z.object({}),
    handler: async () => {
      const { todos } = await import('../../tui/context/todos')
      const items: Todo[] = todos()
      if (items.length === 0) {
        return { success: true, output: '暂无 todo' }
      }
      const lines = items.map((item: Todo) => {
        const icon = item.status === 'completed' ? '✅' : item.status === 'in_progress' ? '🔄' : item.status === 'cancelled' ? '❌' : '⬜'
        return `${icon} [${item.id}] ${item.content}${item.activeForm ? ` (${item.activeForm})` : ''}`
      })
      return { success: true, output: lines.join('\n') }
    },
  })
}

export function registerTodoTools(registry: ToolRegistry): void {
  registerTodoWrite(registry)
  registerTodoRead(registry)
}
