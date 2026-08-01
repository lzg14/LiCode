import type { SyntaxStyle } from "@opentui/core"
import { createMemo, createSignal, For, onMount, Show } from "solid-js"
import type { Message } from "../context/loop"
import { useLoop } from "../context/loop"
import { useTheme } from "../context/theme"
import { createMarkdownSyntaxStyle } from "../util/syntax-style"
import { deriveThinkingDisplay } from "../util/thinking-display"
import { CollapsibleText } from "./collapsible-text"
import { Spinner } from "./spinner"
import { ThinkingView } from "./thinking-view"

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
  // 1 帧延迟挂载：让 <markdown> 内部先 finalize 完再显示，避免用户看到
  // "plain → highlighted → 又变" 闪烁（mount 时的两阶段渲染）。
  // 第 0 帧：fallback 渲染 plain text；第 1 帧 raf 后：切到 <markdown>，已 stable。
  // 用户视觉上只看到 1 次 16ms 内的 plain → highlighted，几乎不可察觉。
  const [mounted, setMounted] = createSignal(false)
  onMount(() => {
    requestAnimationFrame(() => setMounted(true))
  })
  return (
    <Show when={mounted()} fallback={
      <text fg={text()} bg={background()}>{props.content}</text>
    }>
      <markdown
        content={props.content}
        streaming={props.streaming ?? false}
        syntaxStyle={props.syntaxStyle ?? fallbackSyntaxStyle()}
        conceal={true}
        fg={text()}
        bg={background()}
      />
    </Show>
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
          <MarkdownText content={mergedText()} streaming={false} syntaxStyle={props.syntaxStyle} />
        </box>
      </Show>
    </box>
  )
}

function MessageItem(props: { msg: Message; syntaxStyle?: SyntaxStyle }) {
  const { primary, text, textMuted, error, success, warning, info } = useTheme()

  // 响应式计算：在 tracking scope 内包裹 createMemo
  const hasImages = createMemo(() => props.msg.role === "user" && props.msg.images && props.msg.images.length > 0)
  const cleaned = createMemo(() => props.msg.role === "assistant" ? stripSystemTags(props.msg.content) : "")
  const display = createMemo(() => props.msg.role === "assistant" ? deriveThinkingDisplay(cleaned(), true) : undefined)
  const lineCount = createMemo(() => props.msg.role === "assistant" ? props.msg.content.split('\n').length : 0)
  const isLong = createMemo(() => lineCount() > 15)
  const statusIcon = createMemo(() => {
    if (props.msg.role !== "tool") return ""
    return props.msg.toolStatus === "running" ? "⏳"
      : props.msg.toolStatus === "completed" ? "✓"
      : props.msg.toolStatus === "error" ? "✗" : ""
  })
  const statusColor = createMemo(() => {
    if (props.msg.role !== "tool") return warning()
    return props.msg.toolStatus === "completed" ? success()
      : props.msg.toolStatus === "error" ? error() : warning()
  })
  const toolArgs = createMemo(() => {
    if (props.msg.role !== "tool") return ""
    return props.msg.toolArgs && props.msg.toolName ? formatToolArgs(props.msg.toolName, props.msg.toolArgs) : ""
  })
  const isError = createMemo(() => props.msg.role === "system" && (props.msg.content.startsWith('错误:') || props.msg.content.startsWith('Error:')))

  if (props.msg.role === "user") {
    return (
      <box flexDirection="column" marginBottom={1}>
        <box flexDirection="row">
          <text fg={props.msg.queued ? info() : primary()}>
            {props.msg.queued ? "┃ [queued] " : "┃ "}
          </text>
          <CollapsibleText content={props.msg.content} maxLines={5} />
        </box>
        <Show when={hasImages()}>
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
    return (
      <box flexDirection="column" marginBottom={1} flexShrink={0}>
        <Show when={isLong()}>
          <text fg={textMuted()}>{`  (共 ${lineCount()} 行)`}</text>
        </Show>
        <ThinkingView display={display()!} streaming={false} syntaxStyle={props.syntaxStyle} />
      </box>
    )
  }

  if (props.msg.role === "tool") {
    return (
      <box flexDirection="column" marginBottom={0}>
        <box flexDirection="row">
          <Show when={statusIcon()}>
            <text fg={statusColor()}>{` ${statusIcon()}`}</text>
          </Show>
          <text fg={textMuted()}>{` ${props.msg.toolName ?? props.msg.content}`}</text>
        </box>
        <Show when={toolArgs()}>
          <box paddingLeft={1}>
            <CollapsibleText content={toolArgs()} maxLines={5} fg={textMuted()} />
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
          <text fg={isError() ? error() : textMuted()}>{` ┃ `}</text>
          <text fg={isError() ? error() : textMuted()}>{props.msg.content}</text>
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

  // 共享 syntaxStyle：所有 MarkdownText 实例共享同一个，避免每实例 createMemo 重建
  // 见 docs/plans/archive/scroll-smooth-and-thinking-flash.md 方案 5
  const sharedSyntaxStyle = createMemo(() => createMarkdownSyntaxStyle({
    primary: primary(), warning: warning(), success: success(),
    info: info(), text: text(), textMuted: textMuted(), border: border(),
  }))

  // tool-batch 信息：batchId → { count, toolNames, firstMsgId }
  // 与 <For each={messages()}> 分离，避免 processedMessages 每次重建导致全量重渲染
  // SolidJS <For> 用引用相等性做 keyed diff，直接用 messages() 可复用已有 Message 对象
  const toolBatchInfo = createMemo(() => {
    const allMsgs = messages()
    const map = new Map<number, { count: number; toolNames: string[]; firstMsgId: string }>()
    for (const msg of allMsgs) {
      if (msg.role !== 'tool' || !msg.toolBatch || msg.toolBatch <= 0) continue
      const batchId = msg.toolBatch
      const existing = map.get(batchId)
      if (existing) {
        existing.count++
        if (msg.toolName) existing.toolNames.push(msg.toolName)
      } else {
        map.set(batchId, { count: 1, toolNames: msg.toolName ? [msg.toolName] : [], firstMsgId: msg.id })
      }
    }
    return map
  })

  // 展开的批次内容：batchId → { messages: Message[], names: string }
  // 仅在展开时计算，用于在 <For> 外渲染完整批次
  const expandedBatches = createMemo(() => {
    if (!toolCallExpanded()) return new Map()
    const allMsgs = messages()
    const info = toolBatchInfo()
    const result = new Map<number, { msgs: Message[]; names: string }>()
    for (const [batchId, batch] of info) {
      if (batch.count <= 1) continue
      const batchMsgs = allMsgs.filter(m => m.toolBatch === batchId)
      result.set(batchId, {
        msgs: batchMsgs,
        names: batch.toolNames.filter(Boolean).join(', '),
      })
    }
    return result
  })

  // 收集已展开批次的 ID，用于在 <For> 中跳过这些消息
  const expandedBatchIds = createMemo(() => {
    const ids = new Set<number>()
    for (const [batchId] of expandedBatches()) {
      ids.add(batchId)
    }
    return ids
  })

  return (
    <box flexDirection="column" paddingX={1}>
      {/* 展开的批次：在 <For> 外渲染，确保所有消息都显示 */}
      <For each={Array.from(expandedBatches().entries())}>
        {([batchId, batch]) => (
          <box flexDirection="column" marginBottom={0}>
            <box flexDirection="row">
              <text fg={textMuted()}>
                ▾ {batch.msgs.length} 个工具调用
              </text>
              <text fg={textMuted()}>
                {batch.names}
              </text>
            </box>
            <For each={batch.msgs}>
              {(msg) => <MessageItem msg={msg} syntaxStyle={sharedSyntaxStyle()} />}
            </For>
          </box>
        )}
      </For>

      <For each={messages()}>
        {(msg) => {
          // queued 消息由 QueueMessages 单独渲染
          if (msg.queued) return null

          // 跳过已展开批次中的所有消息（已在上面渲染）
          if (msg.role === 'tool' && msg.toolBatch && msg.toolBatch > 0) {
            if (expandedBatchIds().has(msg.toolBatch)) {
              return null
            }
            // 未展开的单个 tool，正常渲染
            return <MessageItem msg={msg} syntaxStyle={sharedSyntaxStyle()} />
          }

          return <MessageItem msg={msg} syntaxStyle={sharedSyntaxStyle()} />
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
