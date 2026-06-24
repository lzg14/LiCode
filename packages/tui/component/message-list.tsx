import { For, Show, Switch, Match, createMemo, createSignal } from "solid-js"
import { useTheme } from "../context/theme"
import { useLoop } from "../context/loop"
import type { Message } from "../context/loop"
import { Spinner } from "./spinner"
import { createMarkdownSyntaxStyle } from "../util/syntax-style"
import { ThinkingView } from "./thinking-view"
import { deriveThinkingDisplay } from "../util/thinking-display"
import { CollapsibleText } from "./collapsible-text"

const MAX_VISIBLE_TOOLS = 3

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

  // 恢复 thinking 标签
  processed = processed.replace(/\x00THINK(\d+)\x00/g, (_, i) => preserved[+i] ?? "")

  return processed.replace(/\n{3,}/g, "\n\n").trim()
}
function MarkdownText(props: { content: string; streaming?: boolean }) {
  const { primary, warning, success, info, text, textMuted, background, border } = useTheme()
  const syntaxStyle = createMemo(() => createMarkdownSyntaxStyle({
    primary: primary(), warning: warning(), success: success(),
    info: info(), text: text(), textMuted: textMuted(), border: border(),
  }))
  return (
    <markdown
      content={props.content}
      streaming={props.streaming ?? false}
      syntaxStyle={syntaxStyle()}
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
function PendingStreamView() {
  const { pendingText, streamMode } = useLoop()
  const { textMuted } = useTheme()
  const display = createMemo(() => deriveThinkingDisplay(pendingText(), false))

  const thinking = createMemo(() => {
    const d = display()
    if (d.kind === 'thinking-only') return d.text
    if (d.kind === 'has-rest') return d.thinking
    return ''
  })
  const rest = createMemo(() => {
    const d = display()
    if (d.kind === 'has-rest') return d.rest
    if (d.kind === 'no-thinking') return d.rest
    return ''
  })

  const isThinkingOnly = createMemo(() => streamMode() === 'in-thinking' || (thinking().length > 0 && !rest()))

  return (
    <box flexDirection="column">
      <Show when={isThinkingOnly()}>
        <box marginBottom={1} paddingLeft={1}>
          <Spinner>思考中</Spinner>
        </box>
      </Show>
      <Show when={rest()}>
        <MarkdownText content={rest()} streaming={true} />
      </Show>
      <Show when={!isThinkingOnly() && !rest() && pendingText()}>
        <box marginBottom={1}>
          <MarkdownText content={pendingText()} streaming={true} />
        </box>
      </Show>
    </box>
  )
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return `${m}m${s}s`
}

function beijingTime(ts: number): string {
  const d = new Date(ts)
  const cst = new Date(d.getTime() + 8 * 60 * 60 * 1000)
  return cst.toISOString().slice(11, 19)
}

function MessageItem(props: { msg: Message }) {
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
              {`📎 ${props.msg.images!.length} 张图片已附带`}
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
        <ThinkingView display={display} streaming={false} />
        <Show when={props.msg.duration !== undefined}>
          <text fg={textMuted()}>{`  ${props.msg.duration}s`}</text>
        </Show>
        <text fg={textMuted()}>{`  ${beijingTime(props.msg.timestamp)}`}</text>
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
    const durText = props.msg.duration !== undefined ? formatDuration(props.msg.duration) : ""
    return (
      <box flexDirection="column" marginBottom={0}>
        <box flexDirection="row">
          <Show when={statusIcon}>
            <text fg={statusColor}>{` ${statusIcon}`}</text>
          </Show>
          <text fg={textMuted()}>{` ${props.msg.toolName ?? props.msg.content}`}</text>
          <Show when={durText}>
            <text fg={textMuted()}>{` (${durText})`}</text>
          </Show>
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

function formatToolArgs(toolName: string, args: Record<string, unknown>): string {
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
  const { messages, streamingSegments, pendingText, isProcessing, toolCallExpanded, toggleToolCallExpanded } = useLoop()
  const { text, textMuted } = useTheme()

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
                    {(tool) => <MessageItem msg={tool} />}
                  </For>
                </Show>
              </box>
            )
          }
          return <MessageItem msg={item.msg} />
        }}
      </For>

      {/* 流式内容：已闭合的段 */}
      <For each={streamingSegments()}>
        {(seg) => {
          if (seg.kind === 'thinking') {
            return (
              <box marginBottom={1} paddingLeft={1}>
                <Spinner>思考中</Spinner>
              </box>
            )
          }
          if (seg.kind === 'system-reminder') {
            return null
          }
          return (
            <box marginBottom={1}>
              <MarkdownText content={seg.text} />
            </box>
          )
        }}
      </For>

      {/* 流式内容：未闭合的 pending 文本 */}
      <Show when={pendingText()}>
        <PendingStreamView />
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
function findToolBatchStart(msgs: Message[], idx: number): number {
  let start = idx
  while (start > 0 && msgs[start - 1].role === "tool") start--
  return start
}

/** 从 idx 开始往后找连续 tool 消息的结束位置 */
function findToolBatchEnd(msgs: Message[], idx: number): number {
  let end = idx
  while (end < msgs.length - 1 && msgs[end + 1].role === "tool") end++
  return end
}
