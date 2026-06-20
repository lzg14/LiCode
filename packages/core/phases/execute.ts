import { generateText, tool, jsonSchema } from "ai"
import { z } from "zod"
import { globalToolRegistry } from "../../tools/registry"
import { devLogger } from "../dev-logger"
import type { Timer } from "../perf"

const SYSTEM_PROMPT = `你是一个名为 licode 的 AI 助手，专注于代码开发。
你的核心理念是"宁可慢，不要白干"——宁可多问清楚，也不要假设。
请用中文回答用户的问题，保持简洁明了。

你可以使用以下工具来帮助用户：

文件操作：
- read: 读取文件内容
- write: 写入文件
- edit: 编辑文件（替换字符串）
- list_directory: 列出目录内容
- create_directory: 创建目录
- delete_file: 删除文件
- move_file: 移动/重命名文件
- copy_file: 复制文件

搜索工具：
- glob: 按模式搜索文件
- grep: 搜索文件内容（正则）
- codesearch: 使用 ripgrep 搜索代码

系统工具：
- bash: 执行 shell 命令
- stat: 获取文件详细信息
- env_vars: 获取环境变量
- system_info: 获取系统信息
- datetime: 获取当前日期时间

Git 工具：
- git_status: 获取 Git 状态
- git_diff: 获取 Git diff
- git_log: 获取 Git 日志
- git_commit: Git 提交

Web 工具：
- webfetch: 获取网页内容
- websearch: 搜索网页（cn.bing.com，国内可用）

开发工具：
- run_tests: 运行测试
- lint: 代码检查（自动检测 eslint/ruff/biome）
- format: 格式化代码（自动检测 prettier/dprint/biome）
- install_deps: 安装依赖

其他工具：
- skill: 加载专业知识或工作流程技能
- database_query: 查询 SQLite 数据库
- apply_patch: 应用代码补丁（unified diff 或 JSON 格式）

当你需要使用工具时，请调用相应的工具。工具调用结果会自动返回给你。

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

  // 完整重建 msgs：摘要（如果存在）+ 历史 + 本轮 user 输入
  // 限制历史消息数量，避免上下文过大
  const MAX_HISTORY = 100
  const rawHistory = ctx.history ?? []
  const history = rawHistory.length > MAX_HISTORY
    ? rawHistory.slice(-MAX_HISTORY)
    : rawHistory

  // 从后往前找到最后一个合法的 user 消息起始点（确保 tool/tool-call 配对完整）
  // 找到最近的 user 消息，从它开始截取（跳过前面的孤立消息）
  function findValidStart(msgs: typeof history): number {
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') {
        // 检查从 i 开始是否 tool/tool-call 配对
        const toolCallIds = new Set<string>()
        const toolResultIds = new Set<string>()
        for (let j = i; j < msgs.length; j++) {
          const m = msgs[j]
          if (Array.isArray(m.content)) {
            for (const p of m.content) {
              if (p.type === 'tool-call') toolCallIds.add(p.toolCallId)
              if (p.type === 'tool-result') toolResultIds.add(p.toolCallId)
            }
          }
        }
        // 找到第一个 user 消息后，检查是否有孤立的 tool-result
        for (const rid of toolResultIds) {
          if (!toolCallIds.has(rid)) return i + 1 // 从下一个 user 消息开始
        }
        return i
      }
    }
    return 0
  }
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
      const fullSystem = activeSkillContent
        ? `${SYSTEM_PROMPT}\n\n## 当前激活技能: ${ctx.activeSkill ?? "?"}\n\n${activeSkillContent}\n\n请严格遵循上述技能的指令与规则。`
        : SYSTEM_PROMPT
      const result = await generateText({
        model: ctx.model,
        system: fullSystem,
        messages: msgs,
        tools,
        temperature: 0.7,
        ...(ctx.signal ? { abortSignal: ctx.signal } : {}),
      })
      const duration = Date.now() - startTime
      if (result.usage) {
        ctx.onLLMResult?.({
          inputTokens: result.usage.inputTokens ?? 0,
          outputTokens: result.usage.outputTokens ?? 0,
          totalTokens: (result.usage.inputTokens ?? 0) + (result.usage.outputTokens ?? 0),
        })
      }
      if (llmId) ctx.timer?.end(llmId, {
        toolCalls: result.toolCalls?.length ?? 0,
        finishReason: result.finishReason ?? 'unknown',
      })
      devLogger.logLLMResponse({
        finishReason: result.finishReason,
        textLength: result.text?.length ?? 0,
        toolCalls: result.toolCalls?.map(tc => ({ tool: tc.toolName, input: tc.input })),
      }, duration)

      // 中间轮（有 tool calls）：文本通过 onIntermediateText 保存为 assistant 消息
      // 最终轮：如果之前有工具调用，也用 onIntermediateText 保存（避免 streaming→message 重复）
      //         如果无工具调用，用 onStreamText 显示（直接回复场景）
      if (result.text) {
        lastChunk = result.text
        if (result.toolCalls?.length) {
          hasToolCalls = true
          ctx.onIntermediateText?.(result.text)
        } else if (hasToolCalls) {
          ctx.onIntermediateText?.(result.text)
        } else {
          fullText = result.text
          ctx.onStreamText?.(result.text)
        }
      }

      if (!result.toolCalls?.length) {
        // 持久化最终 assistant 文本回复
        if (ctx.sessionManager && ctx.sessionId && fullText) {
          try {
            ctx.sessionManager.appendMessageWithParts({
              sessionId: ctx.sessionId,
              role: 'assistant',
              content: [{ type: 'text', text: fullText }],
              model: ctx.model.modelId,
              tokenUsage: result.usage
                ? {
                    input: result.usage.inputTokens ?? 0,
                    output: result.usage.outputTokens ?? 0,
                    reasoning: result.usage.outputTokenDetails?.reasoningTokens,
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
      if (result.text) assistantContent.push({ type: "text", text: result.text })
      for (const tc of result.toolCalls) {
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

      toolBatch++
      devLogger.info('PARALLEL', `Executing ${result.toolCalls.length} tool(s) in batch ${toolBatch}`)
      const toolResults: any[] = await Promise.all(result.toolCalls.map(async (tc) => {
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
          output: { type: "text", value: execResult.success ? (execResult.output ?? "") : `Error: ${execResult.error}` },
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
