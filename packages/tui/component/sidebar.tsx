import { createMemo, Show, For, createSignal, onCleanup } from "solid-js"
import { useTheme } from "../context/theme"
import { useConfig } from "../context/config"
import { useLoop } from "../context/loop"
import { getModelConfig } from "../../llm/catalog"
import { todos } from "../context/todos"

const VERSION = "0.2.0"

export function Sidebar() {
  const { text, textMuted, backgroundPanel, success, primary, warning, error } = useTheme()
  const config = useConfig()
  const { isProcessing, messages, llmCallCount, llmTokenUsage, contextTokens, currentModel, activeSkill, activeSkillInstructions } = useLoop()

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

  // 模型上下文窗口信息
  const modelInfo = createMemo(() => getModelConfig(currentModel()))
  const maxContext = createMemo(() => modelInfo()?.contextWindow ?? 128000)
  const contextUsage = createMemo(() => maxContext() > 0 ? (contextTokens() / maxContext()) * 100 : 0)
  const contextColor = createMemo(() => {
    if (contextUsage() > 95) return error()
    if (contextUsage() > 80) return warning()
    return text()
  })

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
      </box>

      <box flexDirection="column" gap={0} paddingTop={1}>
        <text fg={primary()}>Context</text>
        <box paddingLeft={1} flexDirection="row">
          <text fg={textMuted()}>LLM calls </text>
          <text fg={primary()}>{llmCallCount()}</text>
        </box>
        <box paddingLeft={1} flexDirection="row">
          <text fg={textMuted()}>input </text>
          <text fg={text()}>{(llmTokenUsage().input / 1000).toFixed(1)}K</text>
        </box>
        <box paddingLeft={1} flexDirection="row">
          <text fg={textMuted()}>output </text>
          <text fg={text()}>{(llmTokenUsage().output / 1000).toFixed(1)}K</text>
        </box>
        <box paddingLeft={1} flexDirection="row">
          <text fg={textMuted()}>total </text>
          <text fg={(llmTokenUsage().total > 32000) ? warning() : text()}>
            {(llmTokenUsage().total / 1000).toFixed(1)}K
          </text>
        </box>
        <box paddingLeft={1} flexDirection="row">
          <text fg={textMuted()}>context </text>
          <text fg={contextColor()}>
            {(contextTokens() / 1000).toFixed(1)}K / {(maxContext() / 1000).toFixed(0)}K ({contextUsage().toFixed(0)}%)
          </text>
        </box>
      </box>

      <Show when={msgCount() > 0}>
        <box flexDirection="column" gap={0} paddingTop={1}>
          <text fg={primary()}>Stats</text>
          <box paddingLeft={1} flexDirection="row">
            <text fg={textMuted()}>messages </text>
            <text fg={text()}>{msgCount()}</text>
          </box>
          <box paddingLeft={1} flexDirection="row">
            <text fg={textMuted()}>user </text>
            <text fg={text()}>{userCount()}</text>
          </box>
          <box paddingLeft={1} flexDirection="row">
            <text fg={textMuted()}>assistant </text>
            <text fg={text()}>{assistantCount()}</text>
          </box>
          <Show when={toolCallCount() > 0}>
            <box paddingLeft={1} flexDirection="row">
              <text fg={warning()}>tools </text>
              <text fg={text()}>{toolCallCount()}</text>
            </box>
          </Show>
        </box>
      </Show>

      <Show when={todos().length > 0}>
        <box flexDirection="column" gap={0} paddingTop={1}>
          <text fg={primary()}>Todos</text>
          <box flexDirection="column" paddingLeft={1}>
            <For each={todos()}>
              {(item) => {
                const icon = item.status === 'completed' ? '✅' : item.status === 'in_progress' ? '🔄' : item.status === 'cancelled' ? '❌' : '⬜'
                const displayText = item.content.length > 20 ? item.content.slice(0, 20) + '...' : item.content
                return (
                  <text fg={text()}>
                    {`${icon} ${displayText}`}
                  </text>
                )
              }}
            </For>
          </box>
        </box>
      </Show>

      <Show when={activeSkill()}>
        <box flexDirection="column" gap={0} paddingTop={1}>
          <text fg={primary()}>Skill</text>
          <box paddingLeft={1}>
            <text fg={success()}>{activeSkill()}</text>
          </box>
          <Show when={activeSkillInstructions()}>
            <box flexDirection="column" paddingLeft={1} marginTop={0}>
              <text fg={textMuted()}>{activeSkillInstructions()!.slice(0, 120)}{activeSkillInstructions()!.length > 120 ? '...' : ''}</text>
            </box>
          </Show>
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
