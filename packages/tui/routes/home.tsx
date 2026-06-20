import { createSignal, Show, For } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { useTheme } from "../context/theme"
import { useLoop } from "../context/loop"
import { Logo } from "../component/logo"
import { MessageList } from "../component/message-list"
import { Prompt } from "../component/prompt"
import { StatusBar } from "../component/status-bar"
import { Sidebar } from "../component/sidebar"

export function Home() {
  const { phase, isProcessing, messages, run, compactSession, currentModel, switchModel, getAvailableModels, addMessage } = useLoop()
  const { background, primary, text, textMuted } = useTheme()
  const [sidebarVisible, setSidebarVisible] = createSignal(true)
  const [modelPickerOpen, setModelPickerOpen] = createSignal(false)
  const [modelPickerIdx, setModelPickerIdx] = createSignal(0)

  const toggleModelPicker = () => {
    setModelPickerOpen(prev => !prev)
    setModelPickerIdx(0)
  }

  useKeyboard((evt) => {
    if (evt.ctrl && evt.name === "b") {
      evt.preventDefault()
      setSidebarVisible(prev => !prev)
    }
    if (evt.ctrl && evt.name === "m") {
      evt.preventDefault()
      toggleModelPicker()
    }
    if (modelPickerOpen()) {
      const models = getAvailableModels()
      if (evt.name === "up") {
        evt.preventDefault()
        setModelPickerIdx(prev => (prev - 1 + models.length) % models.length)
      } else if (evt.name === "down") {
        evt.preventDefault()
        setModelPickerIdx(prev => (prev + 1) % models.length)
      } else if (evt.name === "return") {
        evt.preventDefault()
        const selected = models[modelPickerIdx()]
        if (selected) switchModel(selected)
        setModelPickerOpen(false)
      } else if (evt.name === "escape") {
        evt.preventDefault()
        setModelPickerOpen(false)
      }
    }
  })

  const handleSubmit = async (text: string) => {
    if (text.startsWith('/compact')) {
      await compactSession()
      return
    }
    if (text.startsWith('/model')) {
      const arg = text.slice(6).trim()
      if (!arg) {
        toggleModelPicker()
        return
      }
      const models = getAvailableModels()
      const match = models.find(m => m.toLowerCase().includes(arg.toLowerCase()))
      if (match) {
        switchModel(match)
        addMessage({ role: "system", content: `模型已切换为 ${match}` })
      } else {
        addMessage({ role: "system", content: `未找到模型 "${arg}"，可用: ${models.join(', ')}` })
      }
      return
    }
    await run(text)
  }

  return (
    <box flexDirection="row" height="100%">
      <box flexDirection="column" flexGrow={1} backgroundColor={background()}>
        <Show when={modelPickerOpen()}>
          <box
            flexDirection="column"
            position="absolute"
            bottom={4}
            left={1}
            zIndex={5000}
            paddingLeft={1}
            paddingRight={1}
            paddingTop={0}
            paddingBottom={0}
            backgroundColor="#1e1e1e"
            border={["top", "bottom", "left", "right"]}
            borderColor={primary()}
          >
            <text fg={primary()}>{`选择模型 (↑↓ 选择, Enter 确认, Esc 取消)`}</text>
            <For each={getAvailableModels()}>
              {(model, i) => (
                <text fg={i() === modelPickerIdx() ? primary() : text()}>
                  {`${i() === modelPickerIdx() ? '▸ ' : '  '}${model}${model === currentModel() ? ' (当前)' : ''}`}
                </text>
              )}
            </For>
          </box>
        </Show>

        <Show when={messages().length === 0 && !isProcessing()}>
          <box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
            <Logo />
          </box>
        </Show>

        <Show when={messages().length > 0}>
          <scrollbox
            flexGrow={1}
            scrollY={true}
            viewportOptions={{
              paddingRight: 1,
            }}
            verticalScrollbarOptions={{
              visible: true,
              paddingLeft: 1,
            }}
            stickyScroll={true}
            stickyStart="bottom"
          >
            <MessageList />
          </scrollbox>
        </Show>

        <box flexShrink={0}>
          <Prompt onSubmit={handleSubmit} disabled={isProcessing()} />
          <StatusBar />
        </box>
      </box>

      <Sidebar visible={sidebarVisible()} />
    </box>
  )
}
