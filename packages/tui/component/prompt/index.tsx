import { TextareaRenderable } from "@opentui/core"
import { createEffect, createSignal } from "solid-js"
import { useTheme } from "../../context/theme"
import { useHistory } from "../../context/history"
import { useLoop } from "../../context/loop"
import { readClipboardImage } from "../../../tools/builtin"

export interface PromptProps {
  onSubmit: (text: string, images?: Array<{ base64: string; mimeType: string }>) => void
  disabled?: boolean
  placeholder?: string
  onInputChange?: (text: string) => void
  /** 外部弹窗（model picker/provider picker/slash menu）打开时让出上下/回车/ESC */
  popupOpen?: boolean
}

let focusFn: (() => void) | null = null
let setTextFn: ((text: string) => void) | null = null
let prependTextFn: ((text: string) => void) | null = null

export function Prompt(props: PromptProps) {
  const { primary, text, textMuted, backgroundElement, borderActive } = useTheme()
  const history = useHistory()
  const { toggleToolCallExpanded, abort, pendingCount } = useLoop()
  let input: TextareaRenderable
  const [pendingImages, setPendingImages] = createSignal<Array<{ base64: string; mimeType: string }>>([])

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

  createEffect(() => {
    setTextFn = (text: string) => {
      if (!input || input.isDestroyed) return
      input.setText(text)
      input.focus()
    }
  })

  createEffect(() => {
    prependTextFn = (text: string) => {
      if (!input || input.isDestroyed) return
      const current = input.plainText
      input.setText(current + text)
      input.focus()
    }
  })

  const handleSubmit = () => {
    if (!input || input.isDestroyed) return
    const text = input.plainText.trim()
    const images = pendingImages()
    if (!text && images.length === 0) return
    props.onSubmit(text, images.length > 0 ? images : undefined)
    if (text) history.add(text)
    setPendingImages([])
    input.clear()
  }

  const handleKeyDown = async (e: any) => {
    if (props.disabled) return

    // Ctrl+V: 检查剪贴板图片
    if (e.ctrl && e.name === "v") {
      const img = await readClipboardImage()
      if (img) {
        e.preventDefault()
        setPendingImages(prev => [...prev, img])
        return
      }
      // 无图片则让终端处理普通粘贴
    }

    // 弹框打开时，让出 up/down/return/escape 给外层 useKeyboard 处理
    // （不能 preventDefault，否则外层 useKeyboard 收不到）
    if (props.popupOpen && (e.name === "up" || e.name === "down" || e.name === "return" || e.name === "escape")) {
      return
    }

    if (e.name === "up" && (input.plainText.length === 0 || input.cursorOffset === 0)) {
      e.preventDefault()
      const prev = history.up()
      if (prev !== undefined) input.setText(prev)
      return
    }

    if (e.name === "down" && (input.plainText.length === 0 || input.cursorOffset >= input.plainText.length)) {
      e.preventDefault()
      input.setText(history.down())
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

    // 普通字符输入：依赖 50ms 轮询捕获文本变化
    // 不在这里同步调用，因为 opentui keydown 触发时 plainText 可能尚未更新
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
            ? pendingCount() > 0 ? `等待中（队列 ${pendingCount()} 条）...` : "等待响应中..."
            : pendingImages().length > 0 ? `已附带 ${pendingImages().length} 张图片，输入文字后发送...` : props.placeholder ?? "输入消息..."}
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
          onContentChange={() => props.onInputChange?.(input.plainText)}
          onKeyDown={handleKeyDown}
        />
      </box>
    </box>
  )
}

export function focusInput() {
  focusFn?.()
}

export function setPromptText(text: string) {
  setTextFn?.(text)
}

export function prependPromptText(text: string) {
  prependTextFn?.(text)
}
