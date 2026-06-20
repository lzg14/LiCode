import { For, Show, createMemo, createSignal } from "solid-js"
import { useTheme } from "../context/theme"
import { useLoop } from "../context/loop"
import type { Message } from "../context/loop"
import { Spinner } from "./spinner"
import { createMarkdownSyntaxStyle } from "../util/syntax-style"

const MAX_VISIBLE_TOOLS = 3

function stripSystemTags(content: string): string {
  return content.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").replace(/\n{3,}/g, "\n\n").trim()
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

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return `${m}m${s}s`
}

function MessageItem(props: { msg: Message }) {
  const { primary, text, textMuted, error, success, warning } = useTheme()

  if (props.msg.role === "user") {
    return (
      <box flexDirection="row" marginBottom={1}>
        <text fg={primary()}>{"┃ "}</text>
        <text fg={text()}>{props.msg.content}</text>
      </box>
    )
  }

  if (props.msg.role === "assistant") {
    return (
      <box flexDirection="column" marginBottom={1} flexShrink={0}>
        <MarkdownText content={stripSystemTags(props.msg.content)} />
        <Show when={props.msg.duration !== undefined}>
          <text fg={textMuted()}>{`  ${props.msg.duration}s`}</text>
        </Show>
      </box>
    )
  }

  if (props.msg.role === "tool") {
    const statusIcon = props.msg.toolStatus === "running" ? "⏳"
      : props.msg.toolStatus === "completed" ? "✓"
      : props.msg.toolStatus === "error" ? "✗" : ""
    const statusColor = props.msg.toolStatus === "completed" ? success()
      : props.msg.toolStatus === "error" ? error() : warning()
    const toolArgs = props.msg.toolArgs ? formatToolArgs(props.msg.toolName, props.msg.toolArgs) : ""
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
          <text fg={textMuted()}>{`    ${toolArgs}`}</text>
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
  if (toolName === "bash" && args.command) {
    const c = String(args.command)
    return c.length > 50 ? c.substring(0, 50) + "..." : c
  }
  if (toolName === "list_directory" && args.path) return args.path as string
  if (toolName === "websearch" && args.query) return args.query as string
  if (toolName === "webfetch" && args.url) return args.url as string

  const json = JSON.stringify(args)
  return json.length > 50 ? json.substring(0, 50) + "..." : json
}

export function MessageList() {
  const { messages, streamingText, isProcessing, toolCallExpanded, toggleToolCallExpanded } = useLoop()
  const { text, textMuted, background } = useTheme()

  return (
    <box flexDirection="column" flexGrow={1} paddingX={1}>
      <For each={messages()}>
        {(msg, idx) => {
          // 工具调用折叠逻辑：连续 tool 消息超过 MAX_VISIBLE_TOOLS 时折叠
          const allMsgs = messages()
          if (msg.role === "tool") {
            const start = findToolBatchStart(allMsgs, idx())
            const end = findToolBatchEnd(allMsgs, idx())
            const batchSize = end - start + 1

            if (batchSize > MAX_VISIBLE_TOOLS && !toolCallExpanded()) {
              const posInBatch = idx() - start
              if (posInBatch === MAX_VISIBLE_TOOLS) {
                return (
                  <box
                    marginBottom={0}
                    flexDirection="row"
                  >
                    <text fg={textMuted()}>{`    … ${batchSize - MAX_VISIBLE_TOOLS} 个工具调用已折叠 · Ctrl+E 展开`}</text>
                  </box>
                )
              }
              if (posInBatch > MAX_VISIBLE_TOOLS) return null
            }
          }
          return <MessageItem msg={msg} />
        }}
      </For>

      <Show when={streamingText()}>
        <box marginBottom={1}>
          <MarkdownText content={stripSystemTags(streamingText())} streaming={true} />
        </box>
      </Show>

      <Show when={isProcessing() && !streamingText()}>
        <box marginBottom={1}>
          <Spinner>思考中...</Spinner>
        </box>
      </Show>
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