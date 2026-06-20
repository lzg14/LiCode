import { TextareaRenderable } from "@opentui/core"
import { createEffect, createSignal } from "solid-js"
import { useTheme } from "../../context/theme"
import { useHistory } from "../../context/history"
import { useLoop } from "../../context/loop"

export interface PromptProps {
  onSubmit: (text: string) => void
  disabled?: boolean
  placeholder?: string
  onInputChange?: (text: string) => void
  pickerOpen?: boolean
}

let focusFn: (() => void) | null = null

export function Prompt(props: PromptProps) {
  const { primary, text, textMuted, backgroundElement, borderActive } = useTheme()
  const history = useHistory()
  const { toggleToolCallExpanded, abort, pendingCount } = useLoop()
  let input: TextareaRenderable

  createEffect(() => {
    if (!input || input.isDestroyed) return
    if (!input.focused) input.focus()
  })

  createEffect(() => {
    focusFn = () => {
      if (!input || input.isDestroyed) return
      input.focus()
    }
  })

  const handleSubmit = () => {
    if (!input || input.isDestroyed) return
    const text = input.plainText.trim()
    if (!text) return
    props.onSubmit(text)
    history.add(text)
    input.clear()
  }

  const handleKeyDown = (e: any) => {
    if (props.disabled) return

    if (e.name === "up" && (input.plainText.length === 0 || input.cursorOffset === 0)) {
      e.preventDefault()
      const prev = history.up()
      if (prev !== undefined) input.setText(prev)
      props.onInputChange?.(input.plainText)
      return
    }

    if (e.name === "down" && (input.plainText.length === 0 || input.cursorOffset >= input.plainText.length)) {
      e.preventDefault()
      input.setText(history.down())
      props.onInputChange?.(input.plainText)
      return
    }

    if (e.ctrl && e.name === "l") {
      e.preventDefault()
      return
    }

    // Ctrl+E: 展开/折叠工具调用
    if (e.ctrl && e.name === "e") {
      e.preventDefault()
      toggleToolCallExpanded()
      return
    }

    // ESC: 取消当前对话
    if (e.name === "escape") {
      e.preventDefault()
      if (props.disabled) abort()
      return
    }

    // 文字输入类按键：通知父组件文本变化
    // opentui 中普通字符按键的 name 是单字符（"a"、"B"、"/"、"5" 等）
    // 控制键（up/down/escape/return/tab 等）name 是多个字符
    const isControlKey = ["up", "down", "left", "right", "return", "escape", "tab",
      "backspace", "delete", "home", "end", "pageup", "pagedown",
      "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9", "f10", "f11", "f12"]
      .includes(e.name)
    if (!isControlKey && !e.ctrl && !e.alt && !e.meta) {
      setTimeout(() => props.onInputChange?.(input.plainText), 0)
    }
  }

  return (
    <box
      border={["left"]}
      borderColor={borderActive()}
      height={4}
      customBorderChars={{
        topLeft: "",
        bottomLeft: "",
        vertical: "┃",
        topRight: "",
        bottomRight: "",
        horizontal: " ",
        bottomT: "",
        topT: "",
        cross: "",
        leftT: "",
        rightT: "",
      }}
    >
      <box
        paddingLeft={1}
        paddingRight={1}
        paddingTop={1}
        paddingBottom={0}
        backgroundColor={backgroundElement()}
        flexGrow={1}
        height={4}
        justifyContent="center"
      >
        <textarea
          ref={(r: TextareaRenderable) => { input = r }}
          placeholder={props.disabled
            ? pendingCount() > 0 ? `等待中 (队列 ${pendingCount()} 条)...` : "等待响应中..."
            : props.placeholder ?? "输入消息..."}
          placeholderColor={textMuted()}
          textColor={props.disabled ? textMuted() : text()}
          focusedTextColor={text()}
          cursorColor={primary()}
          minHeight={2}
          maxHeight={6}
          keyBindings={[
            { name: "return", action: "submit" },
          ]}
          onSubmit={handleSubmit}
          onKeyDown={handleKeyDown}
        />
      </box>
    </box>
  )
}

export function focusInput() {
  focusFn?.()
}
