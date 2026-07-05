import type { SyntaxStyle } from "@opentui/core"
import { createMemo, For, Show, } from "solid-js"
import type { Message } from "../context/loop"
import { useLoop } from "../context/loop"
import { useTheme } from "../context/theme"
import { createMarkdownSyntaxStyle } from "../util/syntax-style"
import { deriveThinkingDisplay } from "../util/thinking-display"
import { CollapsibleText } from "./collapsible-text"
import { Spinner } from "./spinner"
import { ThinkingView } from "./thinking-view"

const _MAX_VISIBLE_TOOLS = 3

function stripSystemTags(content: string): string {
  // 暂存 thinking 标签（交给 ThinkingView / deriveThinkingDisplay 处理）
  const preserved: string[] = []
  let processed = content
    .replace(/<(thinking|think)>[\s\S]*?<\/(thinking|think)>/g, (m) => {
      preserved.push(m)
      return `\x00THINK${preserved.length - 1}\x00`
    })

  // 剥离所有剩余 HTML/XML 标签（<tool_call>、<mimimax:tool_call> 等）
  processed = processed.replace(/<[^>]*>/g, "")

  // 恢复 thinking 标签（用 \x00 当 placeholder sentinels；故意用控制字符）
  // biome-ignore lint/suspicious/noControlCharactersInRegex: \x00 是 thinking 块占位符的 sentinel
  processed = processed.replace(/\x00THINK(\d+)\x00/g, (_, i) => preserved[+i] ?? "")

  return processed.replace(/\n{3,}/g, "\n\n").trim()
}
function MarkdownText(props: { content: string; streaming?: boolean; syntaxStyle?: SyntaxStyle }) {
  const { primary, warning, success, info, text, textMuted, background, border } = useTheme()
  // 兜底：如果调用方没传 syntaxStyle，自己 memo 一个（保留向后兼容）
  const fallbackSyntaxStyle = createMemo(() => createMarkdownSyntaxStyle({
    primary: primary(), warning: warning(), success: success(),
    info: info(), text: text(), textMuted: textMuted(), border: border(),
  }))
  return (
    <markdown
      content={props.content}
      streaming={props.streaming ?? false}
      syntaxStyle={props.syntaxStyle ?? fallbackSyntaxStyle()}
      conceal={true}
      fg={text()}
      bg={background()}
    />
  )
}

/**
 * PendingStreamView - 渲染未闭合的 streaming 内容
 * streaming 中的 thinking 内容始终灰色 + 可折叠
 */
function PendingStreamView(props: { syntaxStyle?: SyntaxStyle }) {
  const { pendingText, streamMode, streamingSegments } = useLoop()
  const { textMuted } = useTheme()

  // 已闭合的 thinking 段累积（折叠显示前 5 行，让用户看到"在思考"）
  const thinkingText = createMemo(() => {
    return streamingSegments()
      .filter((s) => s.kind === 'thinking')
      .map((s) => s.text)
      .join('\n\n')
  })

  // 合并已闭合的 text 段 + 未闭合的 pending text，让用户看到的内容一直是一个 markdown 组件
  // 这样不会有"非高亮 → 高亮"切换，也没有 markdown 组件频繁 mount 引发闪烁
  const mergedText = createMemo(() => {
    const closed = streamingSegments()
      .filter((s) => s.kind === 'text')
      .map((s) => s.text)
      .join('')
    return closed + pendingText()
  })

  return (
    <box flexDirection="column">
      <Show when={streamMode() === 'in-thinking'}>
        <box marginBottom={1} paddingLeft={1}>
          <Spinner>思考中</Spinner>
        </box>
      </Show>
      {/* thinking 内容用灰色折叠框显示（fbc5161 历史设计），maxLines=5 避免长文占屏 */}
      <Show when={thinkingText()}>
        <box marginBottom={1} paddingLeft={1}>
          <CollapsibleText content={thinkingText()} maxLines={5} fg={textMuted()} />
        </box>
      </Show>
      <Show when={streamMode() !== 'in-thinking' && mergedText()}>
        <box marginBottom={1}>
          <MarkdownText content={mergedText()} streaming={true} syntaxStyle={props.syntaxStyle} />
        </box>
      </Show>
    </box>
  )
}

function MessageItem(props: { msg: Message; syntaxStyle?: SyntaxStyle }) {
  const { primary, text, textMuted, error, success, warning, info } = useTheme()

  if (props.msg.role === "user") {
    const hasImages = props.msg.images && props.msg.images.length > 0
    return (
      <box flexDirection="column" marginBottom={1}>
        <box flexDirection="row">
          <text fg={props.msg.queued ? info() : primary()}>
            {props.msg.queued ? "┃ [queued] " : "┃ "}
          </text>
          <CollapsibleText content={props.msg.content} maxLines={5} />
        </box>
        <Show when={hasImages}>
          <box flexDirection="row" paddingLeft={2}>
            <text fg={textMuted()}>
              {`📎 ${props.msg.images?.length} 张图片已附带`}
            </text>
          </box>
        </Show>
      </box>
    )
  }

  if (props.msg.role === "assistant") {
    const cleaned = stripSystemTags(props.msg.content)
    const display = deriveThinkingDisplay(cleaned, true)
    const lineCount = props.msg.content.split('\n').length
    const isLong = lineCount > 15
    return (
      <box flexDirection="column" marginBottom={1} flexShrink={0}>
        <Show when={isLong}>
          <text fg={textMuted()}>{`  (共 ${lineCount} 行)`}</text>
        </Show>
        {/* 完全照搬 mimocode：markdown 组件永远 streaming={true}
            避免 streaming 切换到 false 触发 finalize 操作的整 viewport 重绘（闪烁） */}
        <ThinkingView display={display} streaming={true} syntaxStyle={props.syntaxStyle} />
      </box>
    )
  }

  if (props.msg.role === "tool") {
    const statusIcon = props.msg.toolStatus === "running" ? "⏳"
      : props.msg.toolStatus === "completed" ? "✓"
      : props.msg.toolStatus === "error" ? "✗" : ""
    const statusColor = props.msg.toolStatus === "completed" ? success()
      : props.msg.toolStatus === "error" ? error() : warning()
    const toolArgs = props.msg.toolArgs && props.msg.toolName ? formatToolArgs(props.msg.toolName, props.msg.toolArgs) : ""
    return (
      <box flexDirection="column" marginBottom={0}>
        <box flexDirection="row">
          <Show when={statusIcon}>
            <text fg={statusColor}>{` ${statusIcon}`}</text>
          </Show>
          <text fg={textMuted()}>{` ${props.msg.toolName ?? props.msg.content}`}</text>
        </box>
        <Show when={toolArgs}>
          <box paddingLeft={1}>
            <CollapsibleText content={toolArgs} maxLines={5} fg={textMuted()} />
          </box>
        </Show>
        <Show when={props.msg.diff}>
          <box flexDirection="column" paddingLeft={2} marginTop={0}>
            <CollapsibleText content={props.msg.diff!} maxLines={10} fg={textMuted()} />
          </box>
        </Show>
      </box>
    )
  }

  if (props.msg.role === "system") {
    const isError = props.msg.content.startsWith('错误:') || props.msg.content.startsWith('Error:')
    // 压缩摘要用 markdown 渲染（有标题、列表等格式）
    if (props.msg.compaction) {
      return (
        <box flexDirection="column" marginBottom={1}>
          <MarkdownText content={props.msg.content} syntaxStyle={props.syntaxStyle} />
        </box>
      )
    }
    return (
      <box marginBottom={0}>
        <box flexDirection="row">
          <text fg={isError ? error() : textMuted()}>{` ┃ `}</text>
          <text fg={isError ? error() : textMuted()}>{props.msg.content}</text>
        </box>
      </box>
    )
  }

  return null
}

export function formatToolArgs(toolName: string, args: Record<string, unknown>): string {
  if (!args) return ""
  
  if (toolName === "read" && args.path) return args.path as string
  if (toolName === "write" && args.path) return args.path as string
  if (toolName === "edit" && args.path) return args.path as string
  if (toolName === "glob" && args.pattern) return args.pattern as string
  if (toolName === "grep" && args.pattern) return args.pattern as string
  if (toolName === "bash" && args.command) return String(args.command)
  if (toolName === "list_directory" && args.path) return args.path as string
  if (toolName === "websearch" && args.query) return args.query as string
  if (toolName === "webfetch" && args.url) return args.url as string

  return JSON.stringify(args)
}

export function QueueMessages() {
  const { messages } = useLoop()
  const { primary, textMuted, warning } = useTheme()
  const queuedMsgs = createMemo(() => messages().filter(m => m.queued && m.role === 'user'))

  return (
    <Show when={queuedMsgs().length > 0}>
      <box flexDirection="column" paddingX={1} flexShrink={0}>
        <For each={queuedMsgs()}>
          {(msg) => (
            <box flexDirection="column" marginBottom={0}>
              <box flexDirection="row">
                <text fg={textMuted()}>┃ [queued] </text>
                <text fg={textMuted()}>{msg.content}</text>
              </box>
            </box>
          )}
        </For>
      </box>
    </Show>
  )
}

export function MessageList() {
  const { messages, streamingSegments, pendingText, isProcessing, toolCallExpanded, toggleToolCallExpanded, streamMode } = useLoop()
  const { primary, warning, success, info, text, textMuted, background, border } = useTheme()

  // 共享 syntaxStyle：所有 MarkdownText 实例共享同一个，避免每实例 createMemo 重建
  // 见 docs/plans/archive/scroll-smooth-and-thinking-flash.md 方案 5
  const sharedSyntaxStyle = createMemo(() => createMarkdownSyntaxStyle({
    primary: primary(), warning: warning(), success: success(),
    info: info(), text: text(), textMuted: textMuted(), border: border(),
  }))

  // 预处理：识别 tool 批次并折叠显示
  const processedMessages = createMemo(() => {
    const allMsgs = messages()
    const result: Array<{ type: 'msg'; msg: Message } | { type: 'tool-batch'; batchId: number; count: number; tools: Message[] }> = []

    let i = 0
    while (i < allMsgs.length) {
      const msg = allMsgs[i]
      if (msg.queued) {
        i++
        continue
      }

      // 检测 tool 批次
      if (msg.role === 'tool') {
        const batchId = msg.toolBatch ?? 0
        const batchTools: Message[] = [msg]

        // 收集同一批次的所有 tool 消息
        let j = i + 1
        while (j < allMsgs.length && allMsgs[j].role === 'tool' && (allMsgs[j].toolBatch ?? 0) === batchId) {
          batchTools.push(allMsgs[j])
          j++
        }

        // 如果批次有多个 tool，折叠显示
        if (batchTools.length > 1 && batchId > 0) {
          result.push({ type: 'tool-batch', batchId, count: batchTools.length, tools: batchTools })
        } else {
          // 单个 tool 或批次 ID 为 0，正常显示
          result.push({ type: 'msg', msg })
        }
        i = j
      } else {
        result.push({ type: 'msg', msg })
        i++
      }
    }
    return result
  })

  return (
    <box flexDirection="column" paddingX={1}>
      <For each={processedMessages()}>
        {(item) => {
          if (item.type === 'tool-batch') {
            const isExpanded = toolCallExpanded()
            return (
              <box flexDirection="column" marginBottom={0}>
                <box flexDirection="row">
                  <text fg={textMuted()}>
                    {isExpanded ? '▾' : '▸'} {item.count} 个工具调用
                  </text>
                  <text fg={textMuted()}>
                    {item.tools.map(t => t.toolName).filter(Boolean).join(', ')}
                  </text>
                </box>
                <Show when={isExpanded}>
                  <For each={item.tools}>
                    {(tool) => <MessageItem msg={tool} syntaxStyle={sharedSyntaxStyle()} />}
                  </For>
                </Show>
              </box>
            )
          }
          return <MessageItem msg={item.msg} syntaxStyle={sharedSyntaxStyle()} />
        }}
      </For>

      {/* 流式内容：只显示未闭合的 pending 文本（实时 markdown 渲染）
          已闭合的段不渲染，回合完成时通过 addMessage 一次性渲染到最终消息
          这样用户看到的内容一直是 pendingText 的 markdown（统一视觉）
          避免"非高亮 → 高亮"切换 + 避免 markdown 组件频繁 mount 引发整 viewport 重绘 */}
      <Show when={pendingText() || streamMode() === 'in-thinking'}>
        <PendingStreamView syntaxStyle={sharedSyntaxStyle()} />
      </Show>

      <Show when={isProcessing() && messages().length === 0 && streamingSegments().length === 0 && !pendingText()}>
        <box marginBottom={1}>
          <Spinner>思考中...</Spinner>
        </box>
      </Show>

      <box height={1} />
    </box>
  )
}

/** 从 idx 开始往前找连续 tool 消息的起始位置 */
function _findToolBatchStart(msgs: Message[], idx: number): number {
  let start = idx
  while (start > 0 && msgs[start - 1].role === "tool") start--
  return start
}

/** 从 idx 开始往后找连续 tool 消息的结束位置 */
function _findToolBatchEnd(msgs: Message[], idx: number): number {
  let end = idx
  while (end < msgs.length - 1 && msgs[end + 1].role === "tool") end++
  return end
}
