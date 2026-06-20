import { createSignal, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { useTheme } from "../context/theme"
import { useLoop } from "../context/loop"
import { Logo } from "../component/logo"
import { PhaseBar } from "../component/phase-bar"
import { MessageList } from "../component/message-list"
import { Prompt } from "../component/prompt"
import { StatusBar } from "../component/status-bar"
import { Sidebar } from "../component/sidebar"

export function Home() {
  const { phase, isProcessing, messages, run, compactSession } = useLoop()
  const { background } = useTheme()
  const [sidebarVisible, setSidebarVisible] = createSignal(true)

  useKeyboard((evt) => {
    if (evt.ctrl && evt.name === "b") {
      evt.preventDefault()
      setSidebarVisible(prev => !prev)
    }
  })

  const handleSubmit = async (text: string) => {
    if (text.startsWith('/compact')) {
      await compactSession()
      return
    }
    await run(text)
  }

  return (
    <box flexDirection="row" height="100%">
      <box flexDirection="column" flexGrow={1} backgroundColor={background()}>
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
