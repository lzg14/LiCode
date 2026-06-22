import { generateText, streamText, tool, jsonSchema } from "ai"
import { z } from "zod"
import { globalToolRegistry } from "../../tools/registry"
import { devLogger } from "../dev-logger"
import type { Timer } from "../perf"
import { readFile } from "fs/promises"
import { existsSync } from "fs"
import { join, dirname } from "path"

/**
 * 从文本中提取 <tool_call> XML 标签作为工具调用
 * streamText 可能不输出结构化的 tool-call chunk，需要从纯文本中解析
 */
function extractToolCallsFromText(text: string): any[] {
  const toolCalls: any[] = []
  const regex = /<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/g
  let match
  while ((match = regex.exec(text)) !== null) {
    try {
      const json = JSON.parse(match[1])
      if (json.name && json.input) {
        toolCalls.push({
          toolCallId: `tc-${Date.now()}-${toolCalls.length}`,
          toolName: json.name,
          input: json.input,
        })
      }
    } catch (e) {
      devLogger.debug('STREAM', `Failed to parse tool_call JSON: ${match[1].slice(0, 100)}`)
    }
  }
  return toolCalls
}

/**
 * 加载项目配置文件（.licode.md / LICODE.md）
 */
const projectConfigCache = new Map<string, string>()

export async function loadProjectConfig(cwd?: string): Promise<string> {
  const dir = cwd || process.cwd()
  
  // 检查缓存
  if (projectConfigCache.has(dir)) {
    return projectConfigCache.get(dir)!
  }
  
  const configFiles = ['.licode.md', 'LICODE.md', '.licode/LICODE.md']
  
  // 加载全局配置
  const homes = process.env.HOME || process.env.USERPROFILE || ''
  let globalConfig = ''
  if (homes) {
    const globalPaths = [
      join(homes, '.licode', 'CLAUDE.md'),
      join(homes, '.licode', 'LICODE.md'),
    ]
    for (const p of globalPaths) {
      try {
        if (existsSync(p)) {
          globalConfig = await readFile(p, 'utf-8')
          devLogger.debug('PROJECT_CONFIG', `Loaded global ${p}`)
          break
        }
      } catch (e) {
        devLogger.debug('PROJECT_CONFIG', `Failed to load global ${p}`, e)
      }
    }
  }
  
  // 加载项目配置
  let projectConfig = ''
  for (const file of configFiles) {
    const fullPath = join(dir, file)
    try {
      if (existsSync(fullPath)) {
        projectConfig = await readFile(fullPath, 'utf-8')
        devLogger.debug('PROJECT_CONFIG', `Loaded project ${fullPath}`)
        break
      }
    } catch (e) {
      devLogger.debug('PROJECT_CONFIG', `Failed to load ${fullPath}`, e)
    }
  }
  
  // 向上查找项目配置
  if (!projectConfig) {
    let currentDir = dir
    while (currentDir !== dirname(currentDir)) {
      currentDir = dirname(currentDir)
      for (const file of configFiles) {
        const fullPath = join(currentDir, file)
        try {
          if (existsSync(fullPath)) {
            projectConfig = await readFile(fullPath, 'utf-8')
            devLogger.debug('PROJECT_CONFIG', `Loaded project ${fullPath}`)
            break
          }
        } catch (e) {
          devLogger.debug('PROJECT_CONFIG', `Failed to load ${fullPath}`, e)
        }
      }
      if (projectConfig) break
    }
  }
  
  // 合并：项目配置优先
  let result: string
  if (projectConfig && globalConfig) {
    result = `## 全局规则\n\n${globalConfig}\n\n## 项目规则\n\n${projectConfig}`
  } else {
    result = projectConfig || globalConfig
  }
  
  // 缓存结果
  projectConfigCache.set(dir, result)
  return result
}

const SYSTEM_PROMPT = `你是一个名为 licode 的 AI 助手，专注于代码开发。
你的核心理念是"宁可慢，不要白干"——宁可多问清楚，也不要假设。
请用中文回答用户的问题，保持简洁明了。

## 规划能力
对于复杂任务（超过 3 个步骤），请先使用 todo_write 创建任务列表，追踪进度。
- todo_write: 写入/更新 todo 列表
- todo_read: 读取当前 todo 列表

示例：
\`\`\`
用户：帮我重构这个模块
你：我先创建任务列表来追踪进度。
[todo_write: 创建 5 个任务]
[todo_read: 确认任务列表]
然后按顺序执行每个任务。
\`\`\`

## 文件操作
- read: 读取文件内容
- write: 写入文件
- edit: 编辑文件（替换字符串）
- list_directory: 列出目录内容
- create_directory: 创建目录
- delete_file: 删除文件
- move_file: 移动/重命名文件
- copy_file: 复制文件

## 搜索工具
- glob: 按模式搜索文件
- grep: 搜索文件内容（正则）
- codesearch: 使用 ripgrep 搜索代码

## 系统工具
- bash: 执行 shell 命令
- stat: 获取文件详细信息
- env_vars: 获取环境变量
- system_info: 获取系统信息
- datetime: 获取当前日期时间

## Git 工具
- git_status: 获取 Git 状态
- git_diff: 获取 Git diff
- git_log: 获取 Git 日志
- git_commit: Git 提交

## Web 工具
- webfetch: 获取网页内容
- websearch: 搜索网页（cn.bing.com，国内可用）

## 开发工具
- run_tests: 运行测试
- lint: 代码检查（自动检测 eslint/ruff/biome）
- format: 格式化代码（自动检测 prettier/dprint/biome）
- install_deps: 安装依赖

其他工具：
- skill: 加载专业知识或工作流程技能
- database_query: 查询 SQLite 数据库

当你需要使用工具时，请使用 XML 标签格式调用工具：

<tool_call>
{"name": "工具名", "input": {"参数1": "值1", "参数2": "值2"}}
</tool_call>

注意：
- **必须使用上述 XML 标签格式**，不要在普通文本中描述要执行的操作
- 工具调用结果会自动返回给你
- 返回 "OK: ..." 表示成功，"Error: ..." 表示失败

## 批量工具调用
当需要多个独立的工具调用时（如同时读取多个文件、同时搜索多个模式等），请在一次回复中**一次性声明所有独立的工具调用**，不要分步进行。独立的工具调用会被并行执行，大幅提升效率。

反例（分步，低效）：
1. 搜索 a → 等待结果
2. 搜索 b → 等待结果

正例（批量，高效）：
1. 同时搜索 a、搜索 b、搜索 c → 一次拿到全部结果

判断独立性的标准：如果两个工具调用的输入互不依赖，就可以声明在同一轮。`

export interface ExecuteContext {
  model: any
  userInput: string
  userImages?: Array<{ base64: string; mimeType: string }>
  cwd?: string
  signal?: AbortSignal
  onLLMCall?: () => void
  onLLMResult?: (usage: { inputTokens: number; outputTokens: number; totalTokens: number }) => void
  onStreamText?: (text: string) => void
  onToolCall?: (toolName: string, args: Record<string, unknown>, batch: number) => void
  onToolResult?: (result: unknown) => void
  /** 工具调用循环中，每轮 LLM 返回文本时触发（用于保存中间 assistant 消息） */
  onIntermediateText?: (text: string) => void
  /** 达到最大迭代次数时询问用户是否继续，返回 true 继续，false 停止 */
  onConfirmContinue?: () => Promise<boolean>
  /**
   * 完整的 AI SDK 消息历史（含 tool-call/tool-result parts）。
   * 来自 sessionManager.getMessagesAsModelMessages()
   */
  history?: Array<{ role: string; content: any[] }>
  /**
   * Session 历史压缩摘要（来自 SessionCompactor）
   * 注入到 msgs 开头，让 LLM 了解之前的对话背景
   */
  sessionSummary?: string
  /** 当前 session 的 id（持久化用） */
  sessionId?: string
  /** SessionManager 实例（持久化用） */
  sessionManager?: any
  /** 当前激活的技能名称（注入到 system prompt） */
  activeSkill?: string | null
  /** 当前激活的技能内容（注入到 system prompt） */
  activeSkillInstructions?: string | null
  /** 性能埋点计时器（可选） */
  timer?: Timer
}

const MAX_ITERATIONS = 100

/**
 * 找到合法的起始位置：确保 tool-call/tool-result 配对完整
 * 当 history 被 slice 截断时，开头可能出现 orphan tool-result（对应的 assistant+tool-call 被截掉）
 */
export function findValidStart(msgs: Array<{ role: string; content: any[] }>): number {
  const allToolCallIds = new Set<string>()
  const allToolResultIds = new Set<string>()
  for (const m of msgs) {
    if (Array.isArray(m.content)) {
      for (const p of m.content) {
        if (p.type === 'tool-call') allToolCallIds.add(p.toolCallId)
        if (p.type === 'tool-result') allToolResultIds.add(p.toolCallId)
      }
    }
  }
  for (const rid of allToolResultIds) {
    if (!allToolCallIds.has(rid)) {
      for (let i = 0; i < msgs.length; i++) {
        if (msgs[i].role === 'user') {
          const chunkCalls = new Set<string>()
          const chunkResults = new Set<string>()
          for (let j = i; j < msgs.length; j++) {
            const m = msgs[j]
            if (Array.isArray(m.content)) {
              for (const p of m.content) {
                if (p.type === 'tool-call') chunkCalls.add(p.toolCallId)
                if (p.type === 'tool-result') chunkResults.add(p.toolCallId)
              }
            }
          }
          let hasOrphan = false
          for (const rid of chunkResults) {
            if (!chunkCalls.has(rid)) { hasOrphan = true; break }
          }
          if (!hasOrphan) return i
        }
      }
      return 0
    }
  }
  return 0
}

function zodToJsonSchema(schema: any): any {
  const raw: any = z.toJSONSchema(schema, { target: 'draft-7' })
  delete raw.$schema
  return raw
}

export async function execute(ctx: ExecuteContext): Promise<string> {
  if (!ctx.model) return "请配置 LLM provider"

  const tools: Record<string, any> = {}
  for (const t of globalToolRegistry.list()) {
    const jsonSchemaDef = zodToJsonSchema(t.inputSchema)

    tools[t.name] = tool({
      description: t.description,
      inputSchema: jsonSchema(jsonSchemaDef),
    })
  }

  // 重建 msgs：摘要（如果存在）+ 最近消息 + 本轮 user 输入
  // 有摘要时只保留 user/assistant 纯文本（摘要已记录工具调用历史）
  // 无摘要时保留全部（最多 100 条）+ tool/tool-call 配对校验
  const rawHistory = ctx.history ?? []
  const hasSummary = !!ctx.sessionSummary
  const PRESERVE_RECENT = hasSummary ? 30 : 100
  const sliced = rawHistory.length > PRESERVE_RECENT
    ? rawHistory.slice(-PRESERVE_RECENT)
    : rawHistory

  let history: typeof rawHistory
  if (hasSummary) {
    // 有摘要：只保留 user/assistant 文本消息，丢弃 tool 角色
    // assistant 消息去掉 tool-call parts，只保留 text
    history = sliced
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => {
        if (Array.isArray(m.content)) {
          const textParts = m.content.filter((p: any) => p.type === 'text')
          if (textParts.length === 0) return null
          return { ...m, content: textParts }
        }
        return m
      })
      .filter((m): m is NonNullable<typeof m> => m !== null)
  } else {
    // 无摘要：保留全部，校验 tool/tool-call 配对
    history = sliced
  }

  // 找到合法的起始位置已提炼为独立函数 findValidStart
  const validStart = findValidStart(history)
  const validHistory = validStart > 0 ? history.slice(validStart) : history
  const lastInHistory = validHistory[validHistory.length - 1]
  const isDuplicate = lastInHistory
    && lastInHistory.role === 'user'
    && Array.isArray(lastInHistory.content)
    && lastInHistory.content.length === 1
    && lastInHistory.content[0]?.type === 'text'
    && lastInHistory.content[0]?.text === ctx.userInput

  // 构造 user 消息内容（支持 multimodal：text + images）
  const userContent: any[] = [{ type: "text", text: ctx.userInput }]
  if (ctx.userImages?.length) {
    for (const img of ctx.userImages) {
      userContent.push({ type: "image", image: `data:${img.mimeType};base64,${img.base64}`, mediaType: img.mimeType })
    }
  }

  const msgs: any[] = isDuplicate
    ? [...validHistory]
    : [...validHistory, { role: "user", content: userContent }]

  // 如果有 session 摘要，注入到 msgs 开头（作为 user 消息 + assistant 确认）
  if (ctx.sessionSummary) {
    msgs.unshift(
      { role: "user", content: [{ type: "text", text: `[系统上下文] 以下是之前对话的摘要，帮助你了解项目背景和已完成的工作：\n\n${ctx.sessionSummary}\n\n请记住这些上下文，继续与用户对话。` }] },
      { role: "assistant", content: [{ type: "text", text: "好的，我已阅读之前的对话摘要，了解了项目背景。" }] }
    )
  }

  let fullText = ""
  let lastChunk = ""
  let toolBatch = 0
  let hasToolCalls = false
  let totalIterations = 0

  while (true) {
    // 第 9 轮起提醒 LLM 收敛
    if (totalIterations === MAX_ITERATIONS - 1) {
      msgs.push({
        role: "user",
        content: [{ type: "text", text: "[系统提醒] 这是最后一步，请基于已有信息直接给出最终回复，不要再调用工具。" }],
      })
    }

    try {
      devLogger.logLLMRequest(
        ctx.model.modelId || 'unknown',
        ctx.model.provider || 'unknown',
        msgs,
        Object.keys(tools).length > 0 ? tools : undefined
      )
      const llmId = ctx.timer?.start('llm.generateText', { iteration: totalIterations })
      ctx.onLLMCall?.()
      const startTime = Date.now()
      // 拼接激活技能的内容（如果有）
      const activeSkillContent = ctx.activeSkillInstructions
      // 加载项目配置文件
      const projectConfig = await loadProjectConfig(ctx.cwd)
      let fullSystem = SYSTEM_PROMPT
      if (projectConfig) {
        fullSystem += `\n\n## 项目配置\n\n${projectConfig}`
      }
      if (activeSkillContent) {
        fullSystem += `\n\n## 当前激活技能: ${ctx.activeSkill ?? "?"}\n\n${activeSkillContent}\n\n请严格遵循上述技能的指令与规则。`
      }
      const streamResult = streamText({
        model: ctx.model,
        system: fullSystem,
        messages: msgs,
        tools,
        temperature: 0.7,
        abortSignal: ctx.signal,
      })

      // 手动消费流，触发 onChunk 回调
      let streamedText = ''
      let streamedToolCalls: any[] = []
      let chunkCount = 0
      try {
        for await (const chunk of streamResult.fullStream) {
          chunkCount++
          devLogger.debug('STREAM', `chunk ${chunkCount}: type=${chunk.type}`)
          if (chunk.type === 'text-delta') {
            streamedText += chunk.text
            ctx.onStreamText?.(chunk.text)
          } else if (chunk.type === 'tool-call') {
            streamedToolCalls.push(chunk)
          } else if (chunk.type === 'error') {
            devLogger.error('STREAM', `error chunk: ${JSON.stringify(chunk)}`)
          }
        }
      } catch (streamError: any) {
        devLogger.error('STREAM', `stream consumption failed: ${streamError}`)
        // 不要重新抛出 streaming 错误，让后续的 catch 块处理
        // 这样不会导致 uncaughtException 触发 process.exit(1)
      }

      devLogger.info('STREAM', `stream completed: chunks=${chunkCount}, text=${streamedText.length}, tools=${streamedToolCalls.length}`)

      // 从 streamedText 中提取 <tool_call> XML 标签作为工具调用
      const textToolCalls = extractToolCallsFromText(streamedText)
      devLogger.debug('STREAM', `textToolCalls from XML tags: ${textToolCalls.length}`)

      // fullStream 可能不输出 tool-call chunks（provider 实现有关）
      // 改从 streamText 结果的 toolCalls 属性获取（stream 结束后可 await）
      const rawToolCalls = await streamResult.toolCalls
      const streamToolCalls = (Array.isArray(rawToolCalls) ? rawToolCalls : []) as any[]
      devLogger.debug('STREAM', `streamToolCalls count: ${streamToolCalls.length}`)

      // 合并：优先用结构化的 streamToolCalls，补充 textToolCalls
      const resolvedToolCalls = streamToolCalls.length > 0 ? streamToolCalls : textToolCalls

      const resolvedResult = {
        text: streamedText || undefined,
        toolCalls: resolvedToolCalls.length > 0 ? resolvedToolCalls : undefined,
        usage: await streamResult.usage,
        finishReason: await streamResult.finishReason,
      }
      const duration = Date.now() - startTime
      if (resolvedResult.usage) {
        ctx.onLLMResult?.({
          inputTokens: resolvedResult.usage.inputTokens ?? 0,
          outputTokens: resolvedResult.usage.outputTokens ?? 0,
          totalTokens: (resolvedResult.usage.inputTokens ?? 0) + (resolvedResult.usage.outputTokens ?? 0),
        })
      }
      if (llmId) ctx.timer?.end(llmId, {
        toolCalls: resolvedResult.toolCalls?.length ?? 0,
        finishReason: resolvedResult.finishReason ?? 'unknown',
      })
      devLogger.logLLMResponse({
        finishReason: resolvedResult.finishReason,
        textLength: resolvedResult.text?.length ?? 0,
        toolCalls: resolvedResult.toolCalls?.map((tc: any) => ({ tool: tc.toolName, input: tc.input })),
      }, duration)

      // 中间轮（有 tool calls）：文本通过 onIntermediateText 保存为 assistant 消息
      // 最终轮：如果之前有工具调用，也用 onIntermediateText 保存（避免 streaming→message 重复）
      //         如果无工具调用，用 onStreamText 显示（直接回复场景）
      if (resolvedResult.text) {
        lastChunk = resolvedResult.text
        if (resolvedResult.toolCalls?.length) {
          hasToolCalls = true
          ctx.onIntermediateText?.(resolvedResult.text)
        } else if (hasToolCalls) {
          ctx.onIntermediateText?.(resolvedResult.text)
        } else {
          fullText = resolvedResult.text
          // 注意：流式文本已经通过 onChunk 回调展示了，这里不再重复调 onStreamText
        }
      }

      if (!resolvedResult.toolCalls?.length) {
        // 持久化最终 assistant 文本回复
        if (ctx.sessionManager && ctx.sessionId && fullText) {
          try {
            ctx.sessionManager.appendMessageWithParts({
              sessionId: ctx.sessionId,
              role: 'assistant',
              content: [{ type: 'text', text: fullText }],
              model: ctx.model.modelId,
              tokenUsage: resolvedResult.usage
                ? {
                    input: resolvedResult.usage.inputTokens ?? 0,
                    output: resolvedResult.usage.outputTokens ?? 0,
                    reasoning: (resolvedResult.usage as any).outputTokenDetails?.reasoningTokens,
                  }
                : undefined,
            })
          } catch (e) {
            devLogger.logException('execute.persistAssistant', e)
          }
        }

        // 如果之前有工具调用，最终文本已通过 onIntermediateText 保存，返回空避免重复
        return hasToolCalls ? "" : fullText
      }

      // 有 tool calls：构建 assistant 消息 + 工具结果消息
      const assistantContent: any[] = []
      if (resolvedResult.text) assistantContent.push({ type: "text", text: resolvedResult.text })
      for (const tc of resolvedResult.toolCalls) {
        assistantContent.push({ type: "tool-call", toolCallId: tc.toolCallId, toolName: tc.toolName, input: tc.input })
      }
      const assistantMsg = { role: "assistant", content: assistantContent }
      msgs.push(assistantMsg)

      // 持久化 assistant（含 tool-call）
      if (ctx.sessionManager && ctx.sessionId) {
        try {
          ctx.sessionManager.appendMessageWithParts({
            sessionId: ctx.sessionId,
            role: 'assistant',
            content: assistantContent,
            model: ctx.model.modelId,
          })
        } catch (e) {
          devLogger.logException('execute.persistAssistantTool', e)
        }
      }

      // 执行工具
      toolBatch++
      devLogger.info('PARALLEL', `Executing ${resolvedResult.toolCalls.length} tool(s) in batch ${toolBatch}`)
      const toolResults: any[] = await Promise.all(resolvedResult.toolCalls.map(async (tc: any) => {
        devLogger.logToolCall(tc.toolName, tc.input)
        const tcInput = tc.input as Record<string, unknown>
        ctx.onToolCall?.(tc.toolName, tcInput, toolBatch)
        const toolId = ctx.timer?.start(`tool.${tc.toolName}`)
        const execResult = await globalToolRegistry.execute(tc.toolName, tcInput, { cwd: ctx.cwd })
        devLogger.logToolCall(tc.toolName, tc.input, execResult)
        if (toolId) ctx.timer?.end(toolId, { success: execResult.success })
        ctx.onToolResult?.(execResult)
        return {
          type: "tool-result" as const,
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          output: {
            type: "text",
            value: execResult.success
              ? `OK: ${execResult.output ?? '(无输出)'}`
              : `Error: ${execResult.error ?? '未知错误'}`,
          },
        }
      }))
      const toolMsg = { role: "tool", content: toolResults }
      msgs.push(toolMsg)

      // 持久化 tool results
      if (ctx.sessionManager && ctx.sessionId) {
        try {
          ctx.sessionManager.appendMessageWithParts({
            sessionId: ctx.sessionId,
            role: 'tool',
            content: toolResults,
          })
        } catch (e) {
          devLogger.logException('execute.persistTool', e)
        }
      }

    } catch (e) {
      devLogger.logException('execute.generateText', e, { iteration: totalIterations, messageCount: msgs.length })
      const error = e instanceof Error ? e.message : String(e)
      ctx.onStreamText?.(`[LLM Error] ${error}\n`)
      return `抱歉，AI 调用失败: ${error}`
    }

    totalIterations++

    // 达到最大迭代次数时，询问用户是否继续
    if (totalIterations >= MAX_ITERATIONS && hasToolCalls) {
      if (ctx.onConfirmContinue) {
        const shouldContinue = await ctx.onConfirmContinue()
        if (shouldContinue) {
          totalIterations = 0
          continue
        }
      }
      break
    }
  }

  return fullText || lastChunk || "已达到最大迭代次数"
}
