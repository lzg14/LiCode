/**
 * JSON 模式 - 所有事件以 JSONL 格式输出
 * 
 * 用法：
 *   licode --mode json -p "hello"
 *   licode --mode json "list files"
 * 
 * 事件类型：
 *   - message: 消息事件
 *   - tool_call: 工具调用
 *   - tool_result: 工具结果
 *   - error: 错误
 *   - done: 完成
 */

import { readFile } from 'fs/promises'
import { resolve } from 'path'
import { streamText } from 'ai'
import { configLoader } from '../../config/loader'
import { createModel } from '../../llm/provider'
import { globalToolRegistry } from '../../tools/registry'
import { registerBuiltinTools } from '../../tools/builtin'
import { zodToJsonSchema } from '../../utils'
import { jsonSchema, tool } from 'ai'
import { homedir } from 'os'

export interface JSONEvent {
  type: 'message' | 'tool_call' | 'tool_result' | 'error' | 'done'
  timestamp: number
  data: Record<string, unknown>
}

/**
 * 输出 JSON 事件
 */
function emitEvent(event: JSONEvent): void {
  console.log(JSON.stringify(event))
}

/**
 * 执行 JSON 模式
 */
export async function runJSON(args: string[]): Promise<void> {
  // 注册内置工具
  registerBuiltinTools()

  // 加载配置
  const homeDir = process.env.HOME || process.env.USERPROFILE || ''
  const config = await configLoader.discoverAndLoad(homeDir)

  // 创建模型
  const { model: llmModel } = await createModel(config.llm)

  // 构建工具
  const tools: Record<string, any> = {}
  for (const t of globalToolRegistry.list()) {
    tools[t.name] = tool({
      description: t.description,
      inputSchema: jsonSchema(zodToJsonSchema(t.inputSchema)),
    })
  }

  // 构建消息
  const messages = [{ role: 'user' as const, content: args.join(' ') }]

  // 开始流式调用
  try {
    const result = streamText({
      model: llmModel,
      messages,
      tools,
      maxSteps: 50,
      onStepFinish: async ({ toolCalls, toolResults }) => {
        // 输出工具调用
        for (const tc of toolCalls) {
          emitEvent({
            type: 'tool_call',
            timestamp: Date.now(),
            data: {
              name: tc.toolName,
              args: tc.args,
            },
          })
        }

        // 输出工具结果
        for (const tr of toolResults) {
          emitEvent({
            type: 'tool_result',
            timestamp: Date.now(),
            data: {
              name: tr.toolName,
              result: tr.result,
            },
          })
        }
      },
    })

    // 输出文本响应
    for await (const chunk of result.textStream) {
      emitEvent({
        type: 'message',
        timestamp: Date.now(),
        data: { text: chunk },
      })
    }

    // 输出完成事件
    const usage = await result.usage
    emitEvent({
      type: 'done',
      timestamp: Date.now(),
      data: {
        usage: {
          input: usage.promptTokens,
          output: usage.completionTokens,
        },
      },
    })
  } catch (e) {
    emitEvent({
      type: 'error',
      timestamp: Date.now(),
      data: {
        message: e instanceof Error ? e.message : String(e),
      },
    })
    process.exit(1)
  }
}
