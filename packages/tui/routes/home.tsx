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
  const { phase, isProcessing, messages, run, compactSession, clearSession, currentModel, currentProvider, switchModel, getAvailableModels, addMessage, setActiveSkill } = useLoop()
  const { background, backgroundPanel, primary, text, textMuted } = useTheme()
  const [modelPickerIdx, setModelPickerIdx] = createSignal(0)

  const toggleModelPicker = () => {
    setModelPickerOpen(prev => !prev)
    setModelPickerIdx(0)
  }

  const handleSubmit = async (text: string, images?: Array<{ base64: string; mimeType: string }>) => {
    // 单独的 "/" 不发送（用户取消 slash 菜单后残留）
    if (text.trim() === '/') {
      addMessage({ role: "system", content: "输入 / 后用 ↑↓ 选择技能/命令，或直接输入 /compact、/clear" })
      return
    }
    if (text.startsWith('/compact')) {
      await compactSession()
      return
    }
    if (text === '/clear') {
      clearSession()
      return
    }
    if (text.startsWith('/skill')) {
      const arg = text.slice(6).trim()
      if (!arg || arg === 'list') {
        const skillList = availableSkills().length > 0
          ? availableSkills().join(', ')
          : '无可用技能（搜索路径: ~/.claude/skills/, ~/.licode/skills/）'
        addMessage({ role: "system", content: `可用技能: ${skillList}\n\n用法: /skill <名称>` })
        return
      }
      // 加载技能并设置为活跃状态
      await setActiveSkill(arg)
      addMessage({ role: "system", content: `技能 "${arg}" 已激活，可在侧栏查看指令` })
      return
    }
    await run(text, { clipboardImages: images })
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
    const paths = [
      join(homes, '.licode', 'skills'),
      join(homes, '.licode', 'skills', 'builtin'),
      join(process.cwd(), 'skills'),
    ]
    const skills: string[] = []
    for (const dir of paths) {
      try {
        for (const f of await readdir(dir)) {
          if (f.endsWith('.skill.md')) skills.push(f.replace('.skill.md', ''))
          else if (f.endsWith('.skill.json')) skills.push(f.replace('.skill.json', ''))
          else if (f.endsWith('.md') && !f.startsWith('.')) skills.push(f.replace('.md', ''))
        }
      } catch {}
    }
    // 去重
    setAvailableSkills([...new Set(skills)])
  }
  scanSkills()

  const slashItems = createMemo(() => {
    const items: { type: string; label: string; desc: string }[] = [
      { type: 'cmd', label: '/clear', desc: '开新会话（清空当前对话）' },
      { type: 'cmd', label: '/compact', desc: '压缩对话历史' },
      { type: 'cmd', label: '/skill', desc: '加载技能 (/skill list 或 /skill <名称>)' },
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
      if (selected.label === '/clear') {
        clearSession()
      } else if (selected.label === '/compact') {
        compactSession()
      } else if (selected.label === '/skill') {
        setSlashOpen(false)
        setSlashInput('')
        setPromptText('/skill ')
        return
      }
    } else if (selected.type === 'skill') {
      // /skill xxx → 调用 setActiveSkill
      const skillName = selected.label.replace('/skill ', '')
      setSlashOpen(false)
      setSlashInput('')
      setActiveSkill(skillName)
      addMessage({ role: "system", content: `技能 "${skillName}" 已激活，可在侧栏查看指令` })
      return
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
    if (slashOpen()) {
      const items = slashItems()
      if (evt.name === "up") { evt.preventDefault(); setSlashIdx(prev => (prev - 1 + items.length) % items.length) }
      else if (evt.name === "down") { evt.preventDefault(); setSlashIdx(prev => (prev + 1) % items.length) }
      else if (evt.name === "tab") {
        evt.preventDefault()
        const selected = items[slashIdx()]
        if (!selected) return
        // 把完整命令填入输入框（带空格便于继续输入参数），菜单关闭
        setPromptText(selected.label + " ")
        setSlashOpen(false)
        setSlashInput("")
        setSlashIdx(0)
      }
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

        <Show when={slashOpen()}>
          <box
            flexDirection="column"
            width="100%"
            paddingX={2}
            paddingY={1}
            backgroundColor={backgroundPanel()}
            border={["top", "bottom", "left", "right"]}
            borderColor={primary()}
            flexShrink={0}
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

        <box flexShrink={0}>
          <Prompt onSubmit={handleSubmit} disabled={isProcessing()} onInputChange={handleInputChange}
            popupOpen={modelPickerOpen() || slashOpen()} />
          <StatusBar />
        </box>
      </box>

      <Show when={sidebarVisible()}>
        <Sidebar />
      </Show>
    </box>
  )
}
