/**
 * Todo 扩展示例
 * 
 * 演示如何使用 licode 扩展系统：
 * - 注册自定义工具
 * - 注册斜杠命令
 * - 监听事件
 */

import type { ExtensionAPI } from '../../types'

/** 内存中的 todo 列表 */
const todos: Array<{ id: number; text: string; done: boolean }> = []
let nextId = 1

export default function(api: ExtensionAPI) {
  const { log } = api

  // ============================================================
  // 注册工具
  // ============================================================

  api.registerTool({
    name: 'todo_add',
    description: '添加一个新的 todo 项',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Todo 内容' },
      },
      required: ['text'],
    },
    execute: async (args) => {
      const text = args.text as string
      const todo = { id: nextId++, text, done: false }
      todos.push(todo)
      log.info(`Added todo #${todo.id}: ${text}`)
      return {
        success: true,
        output: `已添加 todo #${todo.id}: ${text}`,
      }
    },
  })

  api.registerTool({
    name: 'todo_list',
    description: '列出所有 todo 项',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    execute: async () => {
      if (todos.length === 0) {
        return { success: true, output: 'Todo 列表为空' }
      }
      const list = todos
        .map(t => `${t.done ? '✓' : '○'} #${t.id}: ${t.text}`)
        .join('\n')
      return { success: true, output: list }
    },
  })

  api.registerTool({
    name: 'todo_done',
    description: '标记一个 todo 为已完成',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Todo ID' },
      },
      required: ['id'],
    },
    execute: async (args) => {
      const id = args.id as number
      const todo = todos.find(t => t.id === id)
      if (!todo) {
        return { success: false, error: `Todo #${id} 不存在` }
      }
      todo.done = true
      log.info(`Completed todo #${id}`)
      return { success: true, output: `已标记 todo #${id} 为完成` }
    },
  })

  // ============================================================
  // 注册命令
  // ============================================================

  api.registerCommand('todo', {
    description: '管理 todo 列表（/todo [add|list|done] [args]）',
    execute: async (args, ctx) => {
      const parts = args.trim().split(/\s+/)
      const action = parts[0] || 'list'

      switch (action) {
        case 'add': {
          const text = parts.slice(1).join(' ')
          if (!text) {
            ctx.sendMessage('用法: /todo add <内容>')
            return { success: false }
          }
          const todo = { id: nextId++, text, done: false }
          todos.push(todo)
          ctx.sendMessage(`已添加 todo #${todo.id}: ${text}`)
          return { success: true }
        }
        case 'list': {
          if (todos.length === 0) {
            ctx.sendMessage('Todo 列表为空')
          } else {
            const list = todos
              .map(t => `${t.done ? '✓' : '○'} #${t.id}: ${t.text}`)
              .join('\n')
            ctx.sendMessage(list)
          }
          return { success: true }
        }
        case 'done': {
          const id = parseInt(parts[1], 10)
          if (isNaN(id)) {
            ctx.sendMessage('用法: /todo done <id>')
            return { success: false }
          }
          const todo = todos.find(t => t.id === id)
          if (!todo) {
            ctx.sendMessage(`Todo #${id} 不存在`)
            return { success: false }
          }
          todo.done = true
          ctx.sendMessage(`已标记 todo #${id} 为完成`)
          return { success: true }
        }
        default:
          ctx.sendMessage('用法: /todo [add|list|done] [args]')
          return { success: false }
      }
    },
  })

  // ============================================================
  // 监听事件
  // ============================================================

  api.on('session:start', async (event) => {
    log.info(`Session started: ${(event as any).sessionId}`)
  })

  api.on('session:end', async (event) => {
    log.info(`Session ended: ${(event as any).sessionId}`)
  })

  log.info('Todo extension loaded!')
}
