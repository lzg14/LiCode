/**
 * licode Extension System
 * 
 * 提供扩展 API，允许用户自定义工具、命令、事件处理等。
 * 
 * 使用示例：
 * ```typescript
 * import type { ExtensionAPI } from 'licode/packages/extension'
 * 
 * export default function(api: ExtensionAPI) {
 *   // 注册自定义工具
 *   api.registerTool({
 *     name: 'my-tool',
 *     description: '我的自定义工具',
 *     inputSchema: { type: 'object', properties: {} },
 *     execute: async (args, ctx) => {
 *       return { success: true, output: 'Hello!' }
 *     }
 *   })
 * 
 *   // 注册斜杠命令
 *   api.registerCommand('hello', {
 *     description: '打招呼命令',
 *     execute: async (args, ctx) => {
 *       ctx.sendMessage('Hello, World!')
 *       return { success: true }
 *     }
 *   })
 * 
 *   // 监听事件
 *   api.on('session:start', async (event) => {
 *     api.log.info('Session started:', event.sessionId)
 *   })
 * }
 * ```
 */

export { ExtensionManager, getExtensionManager, setExtensionManager } from './manager'
export type {
  CommandContext,
  CommandHandler,
  CommandResult,
  EventHandler,
  EventContext,
  ExtensionAPI,
  ExtensionEventType,
  ExtensionFactory,
  ExtensionInfo,
  ExtensionManifest,
  ToolContext,
  ToolDefinition,
  ToolResult,
  UIComponent,
} from './types'
