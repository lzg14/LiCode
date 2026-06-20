import { createSignal, createMemo, Show, For } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { useTheme } from "../context/theme"
import { useLoop } from "../context/loop"
import { sidebarVisible, setSidebarVisible, modelPickerOpen, setModelPickerOpen } from "../context/shortcuts"
import { Logo } from "../component/logo"
import { MessageList } from "../component/message-list"
import { Prompt, setPromptText } from "../component/prompt"
import { StatusBar } from "../component/status-bar"
import { Sidebar } from "../component/sidebar"

export function Home() {
  const { phase, isProcessing, messages, run, compactSession, currentModel, currentProvider, switchModel, switchProvider, getAvailableModels, getAvailableProviders, addMessage, searchHistory, runWorkflow, listWorkflows } = useLoop()
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

  const handleSubmit = async (text: string, images?: Array<{ base64: string; mimeType: string }>) => {
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
    if (text.startsWith('/workflow') || text.startsWith('/wf')) {
      const arg = text.replace(/^\/w(orkflow|f)\s*/, "").trim()
      if (!arg || arg === "list") {
        const wfs = listWorkflows()
        addMessage({ role: "system", content: `可用 workflow: ${wfs.join(", ")}\n\n用法：/workflow coding <需求>` })
        return
      }
      const [name, ...rest] = arg.split(/\s+/)
      const inputArgs = { input: rest.join(" ") || name }
      addMessage({ role: "system", content: `运行 workflow: ${name}...` })
      const result = await runWorkflow(name, inputArgs)
      if (result.success) {
        addMessage({ role: "system", content: `✓ workflow 完成\n\n${result.output?.summary || JSON.stringify(result.output).slice(0, 500)}` })
      } else {
        addMessage({ role: "system", content: `✗ workflow 失败: ${result.error}` })
      }
      return
    }
    if (text.startsWith('/search')) {
      const query = text.slice(7).trim()
      if (!query) {
        addMessage({ role: "system", content: '用法: /search <关键词>' })
        return
      }
      const results = messages().filter(m =>
        m.content.toLowerCase().includes(query.toLowerCase())
      )
      if (results.length === 0) {
        addMessage({ role: "system", content: `未找到包含 "${query}" 的消息` })
      } else {
        const lines = results.map((m, i) =>
          `${i + 1}. [${m.role}] ${m.content.slice(0, 120).replace(/\n/g, ' ')}${m.content.length > 120 ? '...' : ''}`
        )
        addMessage({ role: "system", content: `找到 ${results.length} 条匹配 "${query}":\n${lines.join('\n')}` })
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
    await run(text, images)
  }

  // ===== 斜杠命令菜单 =====
  const [slashOpen, setSlashOpen] = createSignal(false)
  const [slashInput, setSlashInput] = createSignal("")
  const [slashIdx, setSlashIdx] = createSignal(0)
  const [availableSkills, setAvailableSkills] = createSignal<string[]>([])

  // ===== 历史搜索 =====
  const [searchOpen, setSearchOpen] = createSignal(false)
  const [searchQuery, setSearchQuery] = createSignal("")
  const [searchResults, setSearchResults] = createSignal<Array<{ turn: number; role: string; snippet: string }>>([])
  const [searchIdx, setSearchIdx] = createSignal(0)
  const performSearch = (q: string) => {
    const r = searchHistory(q)
    setSearchResults(r)
    setSearchIdx(0)
  }

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
      { type: 'cmd', label: '/search', desc: '搜索历史消息 (/search 关键词)' },
      { type: 'cmd', label: '/save', desc: '保存会话 (/save 名称)' },
      { type: 'cmd', label: '/load', desc: '加载会话 (/load 名称)' },
      { type: 'cmd', label: '/workflow', desc: '运行工作流 (/workflow coding/research/review)' },
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
      const text = slashInput().trim()
      if (selected.label === '/compact') compactSession()
      else if (selected.label === '/model') toggleModelPicker()
      else if (selected.label === '/provider') toggleProviderPicker()
      else if (selected.label === '/search') {
        // 预填 /search + 空格，让用户继续输入关键词
        setSlashOpen(false)
        setSlashInput('')
        setPromptText('/search ')
        return
      }
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
    if (searchOpen()) {
      if (evt.name === "up") { evt.preventDefault(); setSearchIdx(prev => Math.max(0, prev - 1)) }
      else if (evt.name === "down") { evt.preventDefault(); setSearchIdx(prev => Math.min(searchResults().length - 1, prev + 1)) }
      else if (evt.name === "escape" || evt.name === "return") { evt.preventDefault(); setSearchOpen(false) }
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

        <Show when={searchOpen()}>
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
              width={80}
              paddingX={2}
              paddingY={1}
              backgroundColor={backgroundPanel()}
              border={["top", "bottom", "left", "right"]}
              borderColor={primary()}
            >
              <text fg={primary()}>{`搜索: "${searchQuery()}"  (${searchResults().length} 条结果, Esc 关闭)`}</text>
              <box height={1} />
              <Show
                when={searchResults().length > 0}
                fallback={<text fg={textMuted()}>未找到匹配的消息</text>}
              >
                <For each={searchResults()}>
                  {(r, i) => (
                    <text fg={i() === searchIdx() ? primary() : text()}>
                      {`${i() === searchIdx() ? '▸ ' : '  '}[第 ${r.turn} 轮 · ${r.role}] ${r.snippet}`}
                    </text>
                  )}
                </For>
              </Show>
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
          <Prompt onSubmit={handleSubmit} disabled={isProcessing()} onInputChange={handleInputChange}
            popupOpen={modelPickerOpen() || providerPickerOpen() || slashOpen()} />
          <StatusBar />
        </box>
      </box>

      <Show when={sidebarVisible()}>
        <Sidebar />
      </Show>
    </box>
  )
}
