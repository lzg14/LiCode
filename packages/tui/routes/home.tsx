import { useKeyboard } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { loadAllSkills } from "../../skills/loader"
import { HelpPanel } from "../component/help-panel"
import { Logo } from "../component/logo"
import { MessageList, QueueMessages } from "../component/message-list"
import { Prompt, setPromptText } from "../component/prompt"
import { Sidebar } from "../component/sidebar"
import { StatusBar } from "../component/status-bar"
import { useLoop } from "../context/loop"
import { modelPickerOpen, setModelPickerOpen, setSidebarVisible, sidebarVisible } from "../context/shortcuts"
import { useTheme } from "../context/theme"

const BUILTIN_COMMANDS: { type: string; label: string; desc: string }[] = [
  { type: 'cmd', label: '/clear', desc: '开新会话（清空当前对话）' },
  { type: 'cmd', label: '/compact', desc: '压缩对话历史' },
  { type: 'cmd', label: '/help', desc: '查看所有快捷键' },
  { type: 'cmd', label: '/loop', desc: '定时重复执行 prompt' },
]

export function Home() {
  const { isProcessing, messages, run, compactSession, clearSession, currentModel, switchModel, getAvailableModels, addMessage, setActiveSkill, addLoop, stopLoops, listLoops, scheduler, currentPhase, verifyResults, abort } = useLoop()
  const { background, backgroundPanel, primary, text, textMuted, success, error } = useTheme()
  const [modelPickerIdx, setModelPickerIdx] = createSignal(0)
  const [helpOpen, setHelpOpen] = createSignal(false)
  const [scrollRef, setScrollRef] = createSignal<any>(null)
  const [stickyEnabled, setStickyEnabled] = createSignal(true)

  // 检测用户是否在底部（阈值 3 行），用于控制 stickyScroll
  const checkAtBottom = () => {
    const el = scrollRef()
    if (!el) return
    const atBottom = (el.scrollTop ?? 0) + (el.height ?? 0) >= (el.scrollHeight ?? 0) - 3
    setStickyEnabled(atBottom)
  }

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

  const truncate = (s: string, n = 40) => s.length > n ? `${s.slice(0, n)}…` : s

  const slashItems = createMemo(() => {
    const items = [...BUILTIN_COMMANDS]
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
    // Esc 停止所有循环 或 中断正在运行的 LLM 调用
    // 修复：之前只在 scheduler 有任务时 stopLoops，等待 LLM 响应时 ESC 完全无效
    // 根因：prompt 的 TextareaRenderable 默认 keyBindings 没有 ESC 绑定，但 useKeyboard
    // 也只在 stopLoops 分支处理 ESC，没考虑 abort 当前 LLM 调用
    if (evt.name === "escape" && !modelPickerOpen() && !slashOpen()) {
      if (scheduler.hasTasks()) {
        evt.preventDefault()
        stopLoops()
        return
      }
      if (isProcessing()) {
        evt.preventDefault()
        abort()
        addMessage({ role: "system", content: "已取消当前执行" })
        return
      }
    }
    // Ctrl+D 中断正在运行的 LLM 调用（兜底：prompt 的 TextareaRenderable 默认 keyBindings
    // 把 Ctrl+D 绑到 "delete" action，光标处删除字符，不冒泡到 useKeyboard，所以
    // 等待 LLM 时焦点在 prompt，Ctrl+D 被 prompt 内部吞掉。这条全局 handler 走不到，
    // 仅在焦点不在 prompt 时（如思考完成后用户点击别处）才生效）
    if (evt.ctrl && evt.name === "d" && isProcessing()) {
      evt.preventDefault()
      abort()
      addMessage({ role: "system", content: "已取消当前执行" })
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
    // pendingSlashCmd 有值时，return 键直接执行命令
    if (pendingSlashCmd() && evt.name === "return") {
      evt.preventDefault()
      const cmd = pendingSlashCmd()!
      setPendingSlashCmd(null)
      handleSlashSubmitByLabel(cmd)
      return
    }
    // PageUp/PageDown/Home/End: 直接控制消息列表滚动
    if (evt.name === "pageup") {
      evt.preventDefault()
      scrollRef()?.scrollBy(-0.5, "viewport")
      setTimeout(checkAtBottom, 50)
      return
    }
    if (evt.name === "pagedown") {
      evt.preventDefault()
      scrollRef()?.scrollBy(0.5, "viewport")
      setTimeout(checkAtBottom, 50)
      return
    }
    if (evt.name === "home") {
      evt.preventDefault()
      scrollRef()?.scrollTo(0)
      setTimeout(checkAtBottom, 50)
      return
    }
    if (evt.name === "end") {
      evt.preventDefault()
      scrollRef()?.scrollTo(scrollRef()?.scrollHeight ?? 0)
      setStickyEnabled(true)
      return
    }
  })

  // 监测消息数量变化时的滚动位置，自动控制 stickyScroll
  // 当用户向上滚动看旧消息时，新内容到达不会强制拉回底部
  let lastMsgCount = messages().length
  createEffect(() => {
    const count = messages().length
    if (count > lastMsgCount) {
      // 新消息到达，检查用户是否在底部
      checkAtBottom()
    }
    lastMsgCount = count
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
            ref={setScrollRef}
            flexGrow={1}
            scrollY={true}
            stickyScroll={stickyEnabled()}
            stickyStart="bottom"
            // 完全照搬 mimocode 配置（避免 licode 自创配置引入回归）
            // 关键差异：paddingRight: 1、滚动条 visible
            viewportOptions={{
              paddingRight: 1,
            }}
            verticalScrollbarOptions={{ visible: true }}
          >
            <MessageList />
          </scrollbox>
        </Show>

        {/* 队列消息：始终固定在底部，不随滚动条滚动 */}
        <QueueMessages />

        {/* VERIFY 阶段状态 */}
        <Show when={currentPhase() === 'VERIFY'}>
          <box flexDirection="column" marginBottom={1}>
            <text fg={textMuted()}>🔍 验证交付物...</text>
            <For each={verifyResults()}>
              {(r) => (
                <text fg={r.passed ? success() : error()}>
                  {r.passed ? '✓' : '✗'} {r.message}
                </text>
              )}
            </For>
          </box>
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
