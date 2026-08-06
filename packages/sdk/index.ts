/**
 * licode SDK - 编程接口
 * 
 * 可在其他 Node/Bun 项目中嵌入 licode agent。
 * 
 * 使用示例：
 * ```typescript
 * import { createAgent } from 'licode/packages/sdk'
 * 
 * const agent = createAgent({
 *   provider: 'anthropic',
 *   model: 'claude-sonnet-4-20250514',
 *   apiKey: process.env.ANTHROPIC_API_KEY,
 * })
 * 
 * const result = await agent.prompt('Hello, world!')
 * console.log(result.text)
 * ```
 */

import { generateText, streamText, type LanguageModel } from 'ai'
import { configLoader } from '../config/loader'
import { createModel } from '../llm/provider'
import { globalToolRegistry } from '../tools/registry'
import { registerBuiltinTools } from '../tools/builtin'
import { zodToJsonSchema } from '../core/utils'
import { jsonSchema, tool } from 'ai'
import { homedir } from 'os'

/** Agent 配置 */
export interface AgentConfig {
  /** Provider 名称 */
  provider?: string
  /** Model ID */
  model?: string
  /** API Key */
  apiKey?: string
  /** Base URL (用于自定义 endpoint) */
  baseUrl?: string
  /** 工作目录 */
  cwd?: string
  /** 是否注册内置工具 */
  builtinTools?: boolean
}

/** Agent 结果 */
export interface AgentResult {
  /** 响应文本 */
  text: string
  /** token 使用量 */
  usage: {
    input: number
    output: number
  }
  /** 工具调用历史 */
  toolCalls: Array<{
    name: string
    args: Record<string, unknown>
    result?: unknown
  }>
}

/** Agent 实例 */
export interface Agent {
  /** 发送 prompt 并获取响应 */
  prompt(message: string): Promise<AgentResult>
  /** 流式发送 prompt */
  promptStream(message: string): AsyncGenerator<string>
  /** 获取当前配置 */
  getConfig(): Required<AgentConfig>
}

/**
 * 创建 Agent 实例
 */
export async function createAgent(config: AgentConfig = {}): Promise<Agent> {
  const homeDir = process.env.HOME || process.env.USERPROFILE || ''
  
  // 加载默认配置
  let defaultConfig
  try {
    defaultConfig = await configLoader.discoverAndLoad(homeDir)
  } catch {
    defaultConfig = null
  }

  // 合并配置
  const effectiveConfig: Required<AgentConfig> = {
    provider: config.provider || defaultConfig?.llm.provider || 'anthropic',
    model: config.model || defaultConfig?.llm.model || 'claude-sonnet-4-20250514',
    apiKey: config.apiKey || defaultConfig?.llm.apiKey || '',
    baseUrl: config.baseUrl || defaultConfig?.llm.baseUrl || '',
    cwd: config.cwd || process.cwd(),
    builtinTools: config.builtinTools ?? true,
  }

  // 注册工具
  if (effectiveConfig.builtinTools) {
    registerBuiltinTools()
  }

  // 创建模型
  const { model: llmModel } = await createModel({
    provider: effectiveConfig.provider as any,
    model: effectiveConfig.model,
    apiKey: effectiveConfig.apiKey,
    baseUrl: effectiveConfig.baseUrl,
  })

  // 构建工具映射
  const tools: Record<string, any> = {}
  for (const t of globalToolRegistry.list()) {
    tools[t.name] = tool({
      description: t.description,
      inputSchema: jsonSchema(zodToJsonSchema(t.inputSchema)),
    })
  }

  // 工具调用历史
  const toolCallHistory: AgentResult['toolCalls'] = []

  return {
    getConfig: () => effectiveConfig,

    async prompt(message: string): Promise<AgentResult> {
      const result = await generateText({
        model: llmModel,
        messages: [{ role: 'user', content: message }],
        tools,
        maxSteps: 50,
        onStepFinish: async ({ toolCalls, toolResults }) => {
          for (const tc of toolCalls) {
            toolCallHistory.push({
              name: tc.toolName,
              args: tc.args as Record<string, unknown>,
            })
          }
          for (const tr of toolResults) {
            const existing = toolCallHistory.find(
              (h) => h.name === tr.toolName && !h.result
            )
            if (existing) {
              existing.result = tr.result
            }
          }
        },
      })

      return {
        text: result.text,
        usage: {
          input: result.usage.promptTokens,
          output: result.usage.completionTokens,
        },
        toolCalls: [...toolCallHistory],
      }
    },

    async *promptStream(message: string): AsyncGenerator<string> {
      const result = streamText({
        model: llmModel,
        messages: [{ role: 'user', content: message }],
        tools,
        maxSteps: 50,
        onStepFinish: async ({ toolCalls, toolResults }) => {
          for (const tc of toolCalls) {
            toolCallHistory.push({
              name: tc.toolName,
              args: tc.args as Record<string, unknown>,
            })
          }
          for (const tr of toolResults) {
            const existing = toolCallHistory.find(
              (h) => h.name === tr.toolName && !h.result
            )
            if (existing) {
              existing.result = tr.result
            }
          }
        },
      })

      for await (const chunk of result.textStream) {
        yield chunk
      }
    },
  }
}

// 导出工具注册函数
export { registerBuiltinTools } from '../tools/builtin'
export { globalToolRegistry } from '../tools/registry'
