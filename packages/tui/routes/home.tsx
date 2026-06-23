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
import { HelpPanel } from "../component/help-panel"
import { loadAllSkills } from "../../skills/loader"

export function Home() {
  const { isProcessing, messages, run, compactSession, clearSession, currentModel, currentProvider, switchModel, getAvailableModels, addMessage, setActiveSkill, addLoop, stopLoops, listLoops, scheduler } = useLoop()
  const { background, backgroundPanel, primary, text, textMuted } = useTheme()
  const [modelPickerIdx, setModelPickerIdx] = createSignal(0)
  const [helpOpen, setHelpOpen] = createSignal(false)

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
    if (text === '/help' || text === '?') {
      setHelpOpen(true)
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
          ? availableSkills().map(s => `/${s.name}`).join(', ')
          : '无可用技能（搜索路径: ~/.claude/skills/, ~/.licode/skills/）'
        addMessage({ role: "system", content: `可用技能: ${skillList}\n\n用法: /skill <名称>` })
        return
      }
      // 加载技能并设置为活跃状态
      await setActiveSkill(arg)
      addMessage({ role: "system", content: `技能 "${arg}" 已激活，可在侧栏查看指令` })
      return
    }
    if (text.startsWith('/loop')) {
      const arg = text.slice(5).trim()
      if (!arg || arg === 'list') {
        listLoops()
        return
      }
      if (arg === 'stop' || arg === 'off' || arg === 'cancel') {
        stopLoops()
        return
      }
      const parts = arg.split(/\s+/)
      const firstPart = parts[0]
      const maybeInterval = scheduler.parseInterval(firstPart)
      if (maybeInterval) {
        const prompt = parts.slice(1).join(' ')
        if (!prompt) {
          addMessage({ role: "system", content: "用法: /loop <interval> <prompt>\n示例: /loop 5m check deploy status" })
          return
        }
        addLoop(firstPart, prompt)
      } else {
        addLoop('5m', arg)
      }
      return
    }
    await run(text, { clipboardImages: images })
  }

  // ===== 斜杠命令菜单 =====
  const [slashOpen, setSlashOpen] = createSignal(false)
  const [slashInput, setSlashInput] = createSignal("")
  const [slashIdx, setSlashIdx] = createSignal(0)
  const [availableSkills, setAvailableSkills] = createSignal<Array<{ name: string; description: string }>>([])
  const [pendingSlashCmd, setPendingSlashCmd] = createSignal<string | null>(null)

  const scanSkills = async () => {
    // 用新的 skill loader，直接消费 Claude Code `~/.claude/skills/`
    const skills = await loadAllSkills(process.cwd())
    setAvailableSkills(skills.map(s => ({ name: s.name, description: s.description })))
  }
  scanSkills()

  const truncate = (s: string, n = 40) => s.length > n ? s.slice(0, n) + '…' : s

  const slashItems = createMemo(() => {
    const items: { type: string; label: string; desc: string }[] = [
      { type: 'cmd', label: '/clear', desc: '开新会话（清空当前对话）' },
      { type: 'cmd', label: '/compact', desc: '压缩对话历史' },
      { type: 'cmd', label: '/help', desc: '查看所有快捷键' },
      { type: 'cmd', label: '/loop', desc: '定时重复执行 prompt' },
    ]
    for (const s of availableSkills()) {
      items.push({ type: 'skill', label: `/${s.name}`, desc: truncate(s.description) })
    }
    const filter = slashInput().slice(1).toLowerCase()
    if (!filter) return items
    return items.filter(i => i.label.toLowerCase().includes(filter))
  })

  const handleInputChange = (text: string) => {
    if (pendingSlashCmd()) {
      setPendingSlashCmd(null)
      setSlashOpen(false)
    }
    if (text.startsWith('/')) {
      setSlashInput(text)
      setSlashOpen(true)
      setSlashIdx(0)
    } else {
      setSlashOpen(false)
    }
  }

  const handleSlashSubmitByLabel = (label: string) => {
    if (label === '/clear') {
      clearSession()
    } else if (label === '/compact') {
      compactSession()
    } else if (label === '/help') {
      setHelpOpen(true)
    } else if (label.startsWith('/')) {
      const skillName = label.replace(/^\//, '')
      setActiveSkill(skillName)
      addMessage({ role: "system", content: `技能 "${skillName}" 已激活，可在侧栏查看指令` })
    }
  }

  const handleSlashSubmit = () => {
    const items = slashItems()
    const selected = items[slashIdx()]
    if (!selected) return
    handleSlashSubmitByLabel(selected.label)
    setSlashOpen(false)
  }

  // 全局快捷键（不受 textarea 焦点限制）
  useKeyboard((evt) => {
    // F1: 帮助面板
    if (evt.name === "f1") {
      evt.preventDefault()
      setHelpOpen(prev => !prev)
      return
    }
    // 帮助面板打开时，Esc/F1 关闭
    if (helpOpen()) {
      if (evt.name === "escape" || evt.name === "f1") {
        evt.preventDefault()
        setHelpOpen(false)
        return
      }
      return
    }
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
        setPromptText(selected.label)
        setSlashOpen(false)
        setSlashInput("")
        setSlashIdx(0)
        setPendingSlashCmd(selected.label)
      }
      else if (evt.name === "return") { evt.preventDefault(); handleSlashSubmit() }
      else if (evt.name === "escape") { evt.preventDefault(); setSlashOpen(false); setPendingSlashCmd(null) }
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
            stickyScroll={true}
            stickyStart="bottom"
            viewportOptions={{ paddingRight: 0 }}
            verticalScrollbarOptions={{ visible: false }}
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

        <Show when={helpOpen()}>
          <HelpPanel onClose={() => setHelpOpen(false)} />
        </Show>

        <box flexShrink={0}>
          <Prompt onSubmit={handleSubmit} disabled={isProcessing()} onInputChange={handleInputChange}
            popupOpen={modelPickerOpen() || slashOpen() || helpOpen()}
            pendingSlashCmd={pendingSlashCmd()}
            onSlashCmdConsumed={() => setPendingSlashCmd(null)}
            onSlashSubmit={(cmd) => handleSlashSubmitByLabel(cmd)} />
          <StatusBar />
        </box>
      </box>

      <Show when={sidebarVisible()}>
        <Sidebar />
      </Show>
    </box>
  )
}
