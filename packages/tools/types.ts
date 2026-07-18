import { z } from 'zod'
import type { ToolContext } from './context'

export const ToolResultSchema = <T extends z.ZodTypeAny>(outputSchema: T) =>
  z.object({
    success: z.boolean(),
    output: outputSchema.optional(),
    error: z.string().optional(),
  })

export type ToolResult<T = unknown> = {
  success: boolean
  output?: T
  error?: string
  diff?: string
  imageData?: { base64: string; mimeType: string }
}

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: z.ZodTypeAny
  outputSchema?: z.ZodTypeAny
  maxOutputTokens?: number
  handler: (input: any, ctx: ToolContext) => Promise<ToolResult<any>>
}

export type ToolName =
  // 文件操作
  | 'read' | 'write' | 'edit' | 'list_directory' | 'create_directory'
  | 'delete_file' | 'move_file' | 'copy_file'
  // 搜索
  | 'glob' | 'grep' | 'codesearch'
  // 系统
  | 'stat' | 'bash' | 'env_vars' | 'datetime' | 'system_info'
  // Windows 系统
  | 'process_list' | 'kill_process' | 'open_explorer' | 'open_url' | 'gh'
  // 提权命令（专用工具，避免 Start-Process 进程泄漏）
  | 'elevated_bash'
  // Git
  | 'git_status' | 'git_diff' | 'git_log' | 'git_commit'
  // Web
  | 'webfetch' | 'websearch'
  // 开发工具
  | 'run_tests' | 'install_deps' | 'format' | 'lint'
  // 技能
  | 'skill'
  // 数据库
  | 'database_query'
  // 补丁
  | 'apply_patch'
  // Excel
  | 'excel_read' | 'excel_write'
  // 图片
  | 'read_image'
  // 其他
  | 'todo_write' | 'todo_read'
