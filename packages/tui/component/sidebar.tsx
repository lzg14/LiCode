import { createMemo, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useConfig } from "../context/config"
import { useLoop } from "../context/loop"

const VERSION = "0.1.0"

export function Sidebar() {
  const { text, textMuted, backgroundPanel, success, primary, warning } = useTheme()
  const config = useConfig()
  const { phase, isProcessing, elapsed, messages, llmCallCount, llmTokenUsage, contextTokens } = useLoop()

  const msgCount = createMemo(() => messages().length)
  const toolCallCount = createMemo(() => messages().filter((m) => m.role === "tool").length)
  const assistantCount = createMemo(() => messages().filter((m) => m.role === "assistant").length)
  const userCount = createMemo(() => messages().filter((m) => m.role === "user").length)
  const sessionTitle = createMemo(() => {
    const firstUser = messages().find((m) => m.role === "user")
    if (!firstUser) return "新对话"
    const title = firstUser.content.slice(0, 30)
    return title.length < firstUser.content.length ? title + "..." : title
  })

  const elapsedStr = () => {
    const secs = elapsed()
    if (secs < 60) return `${secs}s`
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return `${m}m${s}s`
  }

  const cwd = () => {
    const dir = config.config().cwd || process.cwd()
    const home = process.env.HOME || process.env.USERPROFILE || ""
    return home ? dir.replace(home, "~") : dir
  }

  return (
    <box
      backgroundColor={backgroundPanel()}
      width={38}
      height="100%"
      flexDirection="column"
      paddingX={2}
      paddingY={1}
      overflow="hidden"
    >
      <box flexDirection="column" gap={1}>
        <text fg={primary()} >{sessionTitle()}</text>
        <box flexDirection="row" gap={1}>
          <text fg={textMuted()} >model</text>
          <text fg={text()} >{config.config().llm.model}</text>
        </box>
        <box flexDirection="row" gap={1}>
          <text fg={textMuted()} >provider</text>
          <text fg={text()} >{config.config().llm.provider}</text>
        </box>
      </box>

      <Show when={msgCount() > 0}>
        <box flexDirection="column" gap={1} paddingTop={1}>
          <text fg={primary()}>Stats</text>
          <box paddingLeft={1} flexDirection="row" gap={1}>
            <text fg={textMuted()}>messages</text>
            <text fg={text()}>{msgCount()}</text>
          </box>
          <box paddingLeft={1} flexDirection="row" gap={1}>
            <text fg={textMuted()}>user</text>
            <text fg={text()}>{userCount()}</text>
          </box>
          <box paddingLeft={1} flexDirection="row" gap={1}>
            <text fg={textMuted()}>assistant</text>
            <text fg={text()}>{assistantCount()}</text>
          </box>
          <Show when={toolCallCount() > 0}>
            <box paddingLeft={1} flexDirection="row" gap={1}>
              <text fg={warning()}>tools</text>
              <text fg={text()}>{toolCallCount()}</text>
            </box>
          </Show>
        </box>
      </Show>

      <Show when={msgCount() > 0 && llmCallCount() > 0}>
        <box flexDirection="column" gap={1} paddingTop={1}>
          <text fg={primary()}>Context</text>
          <box paddingLeft={1} flexDirection="row" gap={1}>
            <text fg={textMuted()}>LLM calls</text>
            <text fg={primary()}>{llmCallCount()}</text>
          </box>
          <box paddingLeft={1} flexDirection="row" gap={1}>
            <text fg={textMuted()}>input</text>
            <text fg={text()}>{(llmTokenUsage().input / 1000).toFixed(1)}K</text>
          </box>
          <box paddingLeft={1} flexDirection="row" gap={1}>
            <text fg={textMuted()}>output</text>
            <text fg={text()}>{(llmTokenUsage().output / 1000).toFixed(1)}K</text>
          </box>
          <box paddingLeft={1} flexDirection="row" gap={1}>
            <text fg={textMuted()}>total</text>
            <text fg={(llmTokenUsage().total > 32000) ? warning() : text()}>
              {(llmTokenUsage().total / 1000).toFixed(1)}K
            </text>
          </box>
          <box paddingLeft={1} flexDirection="row" gap={1}>
            <text fg={textMuted()}>context</text>
            <text fg={contextTokens() > 30000 ? warning() : text()}>
              {(contextTokens() / 1000).toFixed(1)}K
            </text>
          </box>
        </box>
      </Show>

      <Show when={isProcessing()}>
        <box flexDirection="column" gap={1} paddingTop={1}>
          <text fg={textMuted()} >Progress</text>
          <box flexDirection="row" gap={1}>
            <text fg={primary()} >phase</text>
            <text fg={primary()} >{phase()}</text>
          </box>
          <box flexDirection="row" gap={1}>
            <text fg={textMuted()} >elapsed</text>
            <text fg={text()} >{elapsedStr()}</text>
          </box>
        </box>
      </Show>

      <box flexGrow={1} />

      <box flexDirection="column" gap={0} paddingTop={1}>
        <box flexDirection="row" gap={1}>
          <text fg={success()} >●</text>
          <text fg={textMuted()} >Li</text>
          <text fg={text()} >Code</text>
          <text fg={textMuted()} >{VERSION}</text>
        </box>
        <text fg={textMuted()} >{cwd()}</text>
      </box>
    </box>
  )
}
