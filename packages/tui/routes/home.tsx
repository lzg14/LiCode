import { createSignal, createMemo, Show, For } from "solid-js"
import { useTheme } from "../context/theme"
import { useLoop } from "../context/loop"
import { sidebarVisible, setSidebarVisible, modelPickerOpen, setModelPickerOpen } from "../context/shortcuts"
import { Logo } from "../component/logo"
import { MessageList } from "../component/message-list"
import { Prompt } from "../component/prompt"
import { StatusBar } from "../component/status-bar"
import { Sidebar } from "../component/sidebar"

export function Home() {
  const { phase, isProcessing, messages, run, compactSession, currentModel, currentProvider, switchModel, switchProvider, getAvailableModels, getAvailableProviders, addMessage } = useLoop()
  const { background, backgroundPanel, primary, text, textMuted } = useTheme()
  const [modelPickerIdx, setModelPickerIdx] = createSignal(0)
  const [providerPickerOpen, setProviderPickerOpen] = createSignal(false)
  const [providerPickerIdx, setProviderPickerIdx] = createSignal(0)

  const toggleModelPicker = () => {
    setModelPickerOpen(prev => !prev)
    setModelPickerIdx(0)
  }

  const toggleProviderPicker = () => {
    setProviderPickerOpen(prev => !prev)
    setProviderPickerIdx(0)
  }

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
    if (text.startsWith('/provider')) {
      const arg = text.slice(9).trim()
      if (!arg) {
        toggleProviderPicker()
        return
      }
      const providers = getAvailableProviders()
      const match = providers.find(p => p.toLowerCase() === arg.toLowerCase())
      if (match) {
        switchProvider(match)
        addMessage({ role: "system", content: `Provider 已切换为 ${match}` })
      } else {
        addMessage({ role: "system", content: `未找到 provider "${arg}"，可用: ${providers.join(', ')}` })
      }
      return
    }
    if (text.startsWith('/save')) {
      const name = text.slice(5).trim() || `session-${Date.now()}`
      try {
        const { writeFile } = await import("fs/promises")
        const { join } = await import("path")
        const dir = join(process.cwd(), '.licode-saves')
        await import("fs").then(fs => fs.mkdirSync(dir, { recursive: true }))
        const data = JSON.stringify({ messages: messages(), name, savedAt: Date.now() }, null, 2)
        await writeFile(join(dir, `${name}.json`), data, 'utf-8')
        addMessage({ role: "system", content: `会话已保存为 ${name}` })
      } catch (e) {
        addMessage({ role: "system", content: `保存失败: ${e}` })
      }
      return
    }
    if (text.startsWith('/load')) {
      const name = text.slice(5).trim()
      if (!name) {
        // 列出可用保存
        try {
          const { readdir } = await import("fs/promises")
          const { join } = await import("path")
          const dir = join(process.cwd(), '.licode-saves')
          const files = await readdir(dir).catch(() => [])
          const saves = files.filter(f => f.endsWith('.json')).map(f => f.replace('.json', ''))
          addMessage({ role: "system", content: saves.length > 0 ? `可用会话: ${saves.join(', ')}` : '没有已保存的会话' })
        } catch {
          addMessage({ role: "system", content: '没有已保存的会话' })
        }
        return
      }
      try {
        const { readFile } = await import("fs/promises")
        const { join } = await import("path")
        const data = JSON.parse(await readFile(join(process.cwd(), '.licode-saves', `${name}.json`), 'utf-8'))
        if (data.messages?.length) {
          data.messages.forEach((m: any) => addMessage(m))
          addMessage({ role: "system", content: `已加载会话 "${name}" (${data.messages.length} 条消息)` })
        }
      } catch (e) {
        addMessage({ role: "system", content: `加载失败: ${e}` })
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
      { type: 'cmd', label: '/model', desc: '切换模型（当前 provider）' },
      { type: 'cmd', label: '/provider', desc: '切换 LLM provider (anthropic/openai/deepseek)' },
      { type: 'cmd', label: '/save', desc: '保存会话 (/save 名称)' },
      { type: 'cmd', label: '/load', desc: '加载会话 (/load 名称)' },
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
      else if (selected.label === '/provider') toggleProviderPicker()
    }
    setSlashOpen(false)
  }

  // 全局快捷键（不受 textarea 焦点限制）
  useKeyboard((evt) => {
    if (evt.ctrl && evt.name === "b") {
      evt.preventDefault()
      setSidebarVisible(prev => !prev)
      return
    }
    if (evt.ctrl && evt.name === "m") {
      evt.preventDefault()
      toggleModelPicker()
      return
    }
    if (modelPickerOpen()) {
      const models = getAvailableModels()
      if (evt.name === "up") { evt.preventDefault(); setModelPickerIdx(prev => (prev - 1 + models.length) % models.length) }
      else if (evt.name === "down") { evt.preventDefault(); setModelPickerIdx(prev => (prev + 1) % models.length) }
      else if (evt.name === "return") {
        evt.preventDefault()
        const m = models[modelPickerIdx()]
        if (m) switchModel(m)
        setModelPickerOpen(false)
      } else if (evt.name === "escape") { evt.preventDefault(); setModelPickerOpen(false) }
      return
    }
    if (providerPickerOpen()) {
      const providers = getAvailableProviders()
      if (evt.name === "up") { evt.preventDefault(); setProviderPickerIdx(prev => (prev - 1 + providers.length) % providers.length) }
      else if (evt.name === "down") { evt.preventDefault(); setProviderPickerIdx(prev => (prev + 1) % providers.length) }
      else if (evt.name === "return") {
        evt.preventDefault()
        const p = providers[providerPickerIdx()]
        if (p) switchProvider(p)
        setProviderPickerOpen(false)
      } else if (evt.name === "escape") { evt.preventDefault(); setProviderPickerOpen(false) }
      return
    }
    if (slashOpen()) {
      const items = slashItems()
      if (evt.name === "up") { evt.preventDefault(); setSlashIdx(prev => (prev - 1 + items.length) % items.length) }
      else if (evt.name === "down") { evt.preventDefault(); setSlashIdx(prev => (prev + 1) % items.length) }
      else if (evt.name === "return") { evt.preventDefault(); handleSlashSubmit() }
      else if (evt.name === "escape") { evt.preventDefault(); setSlashOpen(false) }
      return
    }
  })

  return (
    <box flexDirection="row" height="100%">
      <box flexDirection="column" flexGrow={1} backgroundColor={background()}>
        <Show when={modelPickerOpen()}>
          <box
            flexDirection="column"
            position="absolute"
            top={0}
            left={0}
            width="100%"
            height="100%"
            zIndex={5000}
            alignItems="center"
            justifyContent="center"
          >
            <box
              flexDirection="column"
              width={60}
              paddingX={2}
              paddingY={1}
              backgroundColor={backgroundPanel()}
              border={["top", "bottom", "left", "right"]}
              borderColor={primary()}
              onKeyDown={(e: any) => {
                if (e.name === "up") { e.preventDefault(); setModelPickerIdx(prev => (prev - 1 + getAvailableModels().length) % getAvailableModels().length) }
                else if (e.name === "down") { e.preventDefault(); setModelPickerIdx(prev => (prev + 1) % getAvailableModels().length) }
                else if (e.name === "return") { e.preventDefault(); const m = getAvailableModels()[modelPickerIdx()]; if (m) { switchModel(m); setModelPickerOpen(false) } }
                else if (e.name === "escape") { e.preventDefault(); setModelPickerOpen(false) }
              }}
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
          </box>
        </Show>

        <Show when={providerPickerOpen()}>
          <box
            flexDirection="column"
            position="absolute"
            top={0}
            left={0}
            width="100%"
            height="100%"
            zIndex={5000}
            alignItems="center"
            justifyContent="center"
          >
            <box
              flexDirection="column"
              width={60}
              paddingX={2}
              paddingY={1}
              backgroundColor={backgroundPanel()}
              border={["top", "bottom", "left", "right"]}
              borderColor={primary()}
              onKeyDown={(e: any) => {
                if (e.name === "up") { e.preventDefault(); setProviderPickerIdx(prev => (prev - 1 + getAvailableProviders().length) % getAvailableProviders().length) }
                else if (e.name === "down") { e.preventDefault(); setProviderPickerIdx(prev => (prev + 1) % getAvailableProviders().length) }
                else if (e.name === "return") { e.preventDefault(); const p = getAvailableProviders()[providerPickerIdx()]; if (p) { switchProvider(p); setProviderPickerOpen(false) } }
                else if (e.name === "escape") { e.preventDefault(); setProviderPickerOpen(false) }
              }}
            >
              <text fg={primary()}>{`选择 Provider (↑↓ 选择, Enter 确认, Esc 取消)`}</text>
              <box height={1} />
              <For each={getAvailableProviders()}>
                {(p, i) => (
                  <text fg={i() === providerPickerIdx() ? primary() : text()}>
                    {`${i() === providerPickerIdx() ? '▸ ' : '  '}${p}${p === currentProvider() ? ' (当前)' : ''}`}
                  </text>
                )}
              </For>
            </box>
          </box>
        </Show>

        <Show when={slashOpen()}>
          <box
            flexDirection="column"
            position="absolute"
            top={0}
            left={0}
            width="100%"
            height="100%"
            zIndex={5000}
            alignItems="center"
            justifyContent="center"
          >
            <box
              flexDirection="column"
              width={60}
              paddingX={2}
              paddingY={1}
              backgroundColor={backgroundPanel()}
              border={["top", "bottom", "left", "right"]}
              borderColor={primary()}
              onKeyDown={(e: any) => {
                if (e.name === "up") { e.preventDefault(); setSlashIdx(prev => (prev - 1 + slashItems().length) % slashItems().length) }
                else if (e.name === "down") { e.preventDefault(); setSlashIdx(prev => (prev + 1) % slashItems().length) }
                else if (e.name === "return") { e.preventDefault(); handleSlashSubmit() }
                else if (e.name === "escape") { e.preventDefault(); setSlashOpen(false) }
              }}
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
          <Prompt onSubmit={handleSubmit} disabled={isProcessing()} onInputChange={handleInputChange} />
          <StatusBar />
        </box>
      </box>

      <Show when={sidebarVisible()}>
        <Sidebar />
      </Show>
    </box>
  )
}
