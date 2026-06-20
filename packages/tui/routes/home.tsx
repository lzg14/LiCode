import { createSignal, createMemo, Show, For } from "solid-js"
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
  const { background, backgroundPanel, primary, text, textMuted } = useTheme()
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
    // 模型选择器导航
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
    // 斜杠命令菜单导航
    if (slashOpen()) {
      const items = slashItems()
      if (evt.name === "up") {
        evt.preventDefault()
        setSlashIdx(prev => (prev - 1 + items.length) % items.length)
      } else if (evt.name === "down") {
        evt.preventDefault()
        setSlashIdx(prev => (prev + 1) % items.length)
      } else if (evt.name === "return") {
        evt.preventDefault()
        handleSlashSubmit()
      } else if (evt.name === "escape") {
        evt.preventDefault()
        setSlashOpen(false)
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

  // ===== 斜杠命令菜单 =====
  const [slashOpen, setSlashOpen] = createSignal(false)
  const [slashInput, setSlashInput] = createSignal("")
  const [slashIdx, setSlashIdx] = createSignal(0)
  const [availableSkills, setAvailableSkills] = createSignal<string[]>([])

  const scanSkills = async () => {
    const { readdir } = await import("fs/promises")
    const { join } = await import("path")
    const homes = process.env.HOME || process.env.USERPROFILE || ""
    const paths = [join(homes, '.agents', 'skills'), join(process.cwd(), 'skills')]
    const skills: string[] = []
    for (const dir of paths) {
      try { for (const f of await readdir(dir)) { if (f.endsWith('.md')) skills.push(f.replace(/\.md$/, '')) } } catch {}
    }
    setAvailableSkills(skills)
  }
  scanSkills()

  const slashItems = createMemo(() => {
    const items: { type: string; label: string; desc: string }[] = [
      { type: 'cmd', label: '/compact', desc: '压缩对话历史' },
      { type: 'cmd', label: '/model', desc: '切换模型' },
    ]
    for (const s of availableSkills()) {
      items.push({ type: 'skill', label: `/skill ${s}`, desc: `加载技能 ${s}` })
    }
    const filter = slashInput().slice(1).toLowerCase()
    if (!filter) return items
    return items.filter(i => i.label.toLowerCase().includes(filter))
  })

  const handleInputChange = (text: string) => {
    if (text.startsWith('/')) {
      setSlashInput(text)
      setSlashOpen(true)
      setSlashIdx(0)
    } else {
      setSlashOpen(false)
    }
  }

  const handleSlashSubmit = () => {
    const items = slashItems()
    const selected = items[slashIdx()]
    if (!selected) return
    if (selected.type === 'cmd') {
      if (selected.label === '/compact') compactSession()
      else if (selected.label === '/model') toggleModelPicker()
    }
    setSlashOpen(false)
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
            width={50}
            paddingX={2}
            paddingY={1}
            backgroundColor={backgroundPanel()}
            border={["top", "bottom", "left", "right"]}
            borderColor={primary()}
          >
            <text fg={primary()}>{`选择模型 (↑↓ 选择, Enter 确认, Esc 取消)`}</text>
            <box height={1} />
            <For each={getAvailableModels()}>
              {(model, i) => (
                <text fg={i() === modelPickerIdx() ? primary() : text()}>
                  {`${i() === modelPickerIdx() ? '▸ ' : '  '}${model}${model === currentModel() ? ' (当前)' : ''}`}
                </text>
              )}
            </For>
          </box>
        </Show>

        <Show when={slashOpen()}>
          <box
            flexDirection="column"
            position="absolute"
            bottom={4}
            left={1}
            zIndex={5000}
            width={50}
            paddingX={2}
            paddingY={1}
            backgroundColor={backgroundPanel()}
            border={["top", "bottom", "left", "right"]}
            borderColor={primary()}
          >
            <text fg={primary()}>命令 ({slashInput()})</text>
            <box height={1} />
            <For each={slashItems()}>
              {(item, i) => (
                <text fg={i() === slashIdx() ? primary() : text()}>
                  {`${i() === slashIdx() ? '▸ ' : '  '}${item.label}  ${item.desc}`}
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
          <Prompt onSubmit={handleSubmit} disabled={isProcessing()} onInputChange={handleInputChange} pickerOpen={modelPickerOpen() || slashOpen()} />
          <StatusBar />
        </box>
      </box>

      <Sidebar visible={sidebarVisible()} />
    </box>
  )
}
