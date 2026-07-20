import { createMemo, createSignal, For, onMount, Show } from "solid-js"
import type { SyntaxStyle } from "@opentui/core"
import type { Message } from "../context/loop"
import { useLoop } from "../context/loop"
import { useTheme } from "../context/theme"
import { createMarkdownSyntaxStyle } from "../util/syntax-style"
import { deriveThinkingDisplay } from "../util/thinking-display"
import { CollapsibleText } from "./collapsible-text"
import { Spinner } from "./spinner"
import { StaticMarkdown } from "./static-markdown"
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

/**
 * PendingStreamView - 渲染未闭合的 streaming 内容
 *
 * 关键设计（解决 "总闪烁" 根因）：
 * - 已闭合段（thinking/text segment）：内容稳定，<StaticMarkdown> 渲染（保留 markdown 结构）
 * - 未闭合的 pending text：内容每 60ms 变一次，用纯 <text> 渲染避免 re-parse 闪烁
 *   回合完成时通过 addMessage 一次性存入 message，再以 <StaticMarkdown> 渲染（带 markdown）
 *
 * 这样用户视觉上：
 * - 思考过程：实时 streaming（plain text，但能 "看到在思考"）+ 回合完成时升级为 markdown
 * - 正文：实时 streaming（plain text）+ 回合完成时升级为 markdown
 * - 不会看到 markdown 组件频繁 mount/unmount 引发整 viewport 重绘
 */
function PendingStreamView(props: { syntaxStyle?: SyntaxStyle }) {
  const { pendingText, streamMode, streamingSegments } = useLoop()
  const { text, textMuted } = useTheme()

  // 已闭合的 thinking 段：内容稳定 → 安全用 markdown 渲染（用户能看到思考结构）
  const thinkingText = createMemo(() => {
    return streamingSegments()
      .filter((s) => s.kind === 'thinking')
      .map((s) => s.text)
      .join('\n\n')
  })

  // 已闭合的 text 段：内容稳定 → 用 markdown 渲染
  const closedText = createMemo(() => {
    return streamingSegments()
      .filter((s) => s.kind === 'text')
      .map((s) => s.text)
      .join('')
  })

  return (
    <box flexDirection="column">
      <Show when={streamMode() === 'in-thinking'}>
        <box marginBottom={1} paddingLeft={1}>
          <Spinner>思考中</Spinner>
        </box>
      </Show>
      {/* thinking 内容：闭合段用 markdown 渲染（无 flicker） */}
      <Show when={thinkingText()}>
        <box marginBottom={1} paddingLeft={1} border={["left"]} borderColor={textMuted()}>
          <text fg={textMuted()}>{"💭 思考过程"}</text>
          <StaticMarkdown content={thinkingText()} syntaxStyle={props.syntaxStyle} />
        </box>
      </Show>
      {/* 已闭合的 text 段：内容稳定 → markdown 渲染 */}
      <Show when={streamMode() !== 'in-thinking' && closedText()}>
        <box marginBottom={1}>
          <StaticMarkdown content={closedText()} syntaxStyle={props.syntaxStyle} />
        </box>
      </Show>
      {/* 未闭合的 pending text：内容每 60ms 变 → 纯文本渲染避免 flicker
          回合完成时由 addMessage 把整段存入 message，<MessageItem> 会用 markdown 渲染 */}
      <Show when={streamMode() !== 'in-thinking' && pendingText()}>
        <box marginBottom={1} paddingLeft={1}>
          <text fg={text()}>{pendingText()}</text>
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
        <ThinkingView display={display} streaming={false} syntaxStyle={props.syntaxStyle} msg={props.msg} />
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
          <StaticMarkdown msg={props.msg} syntaxStyle={props.syntaxStyle} />
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
  const { textMuted } = useTheme()
  const queuedMsgs = createMemo(() => messages().filter(m => m.queued && m.role === 'user'))

  return (
    <Show when={queuedMsgs().length > 0}>
      <box flexDirection="column" paddingX={1} flexShrink={0}>
        <For each={queuedMsgs()}>
          {(msg) => (
            <box flexDirection="column" marginBottom={0}>
              <box flexDirection="row">
                <text fg={textMuted()}>┃ [queued] </text>
                <CollapsibleText content={msg.content} maxLines={5} fg={textMuted()} />
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

  // 共享 syntaxStyle：所有 StaticMarkdown 实例共享同一个，避免每实例 createMemo 重建
  // 配合 markdown-cache 的 token 缓存，进一步保证"历史 message 永不重新 parse"
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

      <box height={2} />
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
