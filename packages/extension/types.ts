/**
 * licode Extension API 类型定义
 * 
 * 参考 pi-coding-agent 的扩展系统设计，允许用户自定义：
 * - 工具 (tools)
 * - 命令 (commands)
 * - 事件处理器 (event handlers)
 * - UI 组件 (UI components)
 */

import type { SkillIndex } from '../skills/types'

// ============================================================
// 工具相关
// ============================================================

/** 工具定义 */
export interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  execute: (args: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>
}

/** 工具执行上下文 */
export interface ToolContext {
  cwd: string
  sessionId: string
  signal?: AbortSignal
  onStreamText?: (text: string) => void
}

/** 工具执行结果 */
export interface ToolResult {
  success: boolean
  output?: string
  error?: string
  metadata?: Record<string, unknown>
}

// ============================================================
// 命令相关
// ============================================================

/** 命令处理器 */
export interface CommandHandler {
  /** 命令描述（显示在 /help 中） */
  description: string
  /** 执行命令 */
  execute: (args: string, context: CommandContext) => Promise<CommandResult>
}

/** 命令执行上下文 */
export interface CommandContext {
  cwd: string
  sessionId: string
  /** 发送消息给用户 */
  sendMessage: (text: string) => void
  /** 刷新 UI */
  refresh: () => void
}

/** 命令执行结果 */
export interface CommandResult {
  success: boolean
  message?: string
}

// ============================================================
// 事件系统
// ============================================================

/** 扩展支持的事件类型 */
export type ExtensionEventType =
  | 'session:start'
  | 'session:end'
  | 'tool:call'
  | 'tool:result'
  | 'message:user'
  | 'message:assistant'
  | 'config:loaded'
  | 'startup'
  | 'shutdown'

/** 事件处理器 */
export interface EventHandler<T = unknown> {
  (event: T, context: EventContext): Promise<void> | void
}

/** 事件上下文 */
export interface EventContext {
  cwd: string
  sessionId?: string
  [key: string]: unknown
}

// ============================================================
// UI 组件（预留接口）
// ============================================================

/** UI 组件定义 */
export interface UIComponent {
  name: string
  type: 'header' | 'footer' | 'sidebar' | 'overlay'
  render: () => unknown
}

// ============================================================
// 扩展 API
// ============================================================

/** 扩展 API 接口 */
export interface ExtensionAPI {
  /** 注册自定义工具 */
  registerTool(tool: ToolDefinition): void
  
  /** 注册斜杠命令 */
  registerCommand(name: string, handler: CommandHandler): void
  
  /** 监听事件 */
  on<T = unknown>(event: ExtensionEventType, handler: EventHandler<T>): void
  
  /** 注册 UI 组件（预留） */
  registerUI(component: UIComponent): void
  
  /** 获取扩展信息 */
  getExtensionInfo(): ExtensionInfo
  
  /** 日志工具 */
  log: {
    info: (message: string, ...args: unknown[]) => void
    warn: (message: string, ...args: unknown[]) => void
    error: (message: string, ...args: unknown[]) => void
    debug: (message: string, ...args: unknown[]) => void
  }
}

/** 扩展信息 */
export interface ExtensionInfo {
  name: string
  version?: string
  description?: string
  author?: string
}

/** 扩展入口函数 */
export type ExtensionFactory = (api: ExtensionAPI) => Promise<void> | void

// ============================================================
// 扩展元数据（package.json 中的 pi 字段）
// ============================================================

export interface ExtensionManifest {
  /** 扩展名称 */
  name: string
  /** 版本 */
  version?: string
  /** 描述 */
  description?: string
  /** 作者 */
  author?: string
  /** 入口文件 */
  main?: string
  /** 关键词 */
  keywords?: string[]
}
