import { TextareaRenderable } from "@opentui/core"
import { createEffect, createSignal } from "solid-js"
import { useTheme } from "../../context/theme"
import { useHistory } from "../../context/history"
import { useLoop } from "../../context/loop"
import { readClipboardImage } from "../../../tools/builtin"
import { copyToClipboard, readFromClipboard } from "../../util/clipboard"

export interface PromptProps {
  onSubmit: (text: string, images?: Array<{ base64: string; mimeType: string }>) => void
  disabled?: boolean
  placeholder?: string
  onInputChange?: (text: string) => void
  popupOpen?: boolean
}

let focusFn: (() => void) | null = null
let setTextFn: ((text: string) => void) | null = null
let prependTextFn: ((text: string) => void) | null = null

export function Prompt(props: PromptProps) {
  const { primary, text, textMuted, backgroundElement, borderActive } = useTheme()
  const history = useHistory()
  const { toggleToolCallExpanded, abort, pendingCount, addMessage } = useLoop()
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
      input.cursorOffset = text.length
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
    if (!input || input.isDestroyed) return

    const sel = input.getSelection()
    const hasSelection = sel !== null && sel.start !== sel.end

    // ESC: 弹窗打开时让外层 useKeyboard 关闭弹窗；否则用于中断/清队列或清除选择
    if (e.name === "escape") {
      if (props.popupOpen) return
      e.preventDefault()
      if (hasSelection) {
        input.clearSelection()
        return
      }
      if (props.disabled) {
        abort()
        addMessage({ role: "system", content: "已取消当前执行" })
      } else if (pendingCount() > 0) {
        abort()
        addMessage({ role: "system", content: `已清空队列（${pendingCount()} 条）` })
      }
      return
    }

    if (props.disabled) return

    // ─── Ctrl 修饰键 ───────────────────────────────────────
    if (e.ctrl) {
      // Ctrl+C: 有选择 → 复制；无选择 → 保留 abort 逻辑
      if (e.name === "c" && !e.shift) {
        if (hasSelection) {
          e.preventDefault()
          const text = input.getSelectedText()
          if (text) await copyToClipboard(text)
          return
        }
        return
      }

      // Ctrl+X: 有选择 → 剪切；无选择 → 删除到行尾
      if (e.name === "x") {
        e.preventDefault()
        if (hasSelection) {
          const text = input.getSelectedText()
          if (text) await copyToClipboard(text)
          input.deleteSelection()
        } else {
          input.deleteToLineEnd()
        }
        return
      }

      // Ctrl+V: 检查剪贴板图片
      if (e.name === "v") {
        const img = await readClipboardImage()
        if (img) {
          e.preventDefault()
          setPendingImages(prev => [...prev, { base64: img.data, mimeType: img.mime }])
          return
        }
        // 无图片 → 粘贴文本
        const clipText = await readFromClipboard()
        if (clipText) {
          e.preventDefault()
          if (hasSelection) input.deleteSelection()
          input.insertText(clipText)
        }
        return
      }

      // Ctrl+Shift+A: 全选
      if (e.name === "a" && e.shift) {
        e.preventDefault()
        input.selectAll()
        return
      }

      // Ctrl+A: 移到行首
      if (e.name === "a" && !e.shift) {
        e.preventDefault()
        if (hasSelection) input.clearSelection()
        input.gotoLineHome()
        return
      }

      // Ctrl+E: 移到行尾
      if (e.name === "e" && !e.shift) {
        e.preventDefault()
        if (hasSelection) input.clearSelection()
        input.gotoLineEnd()
        return
      }

      // Ctrl+Shift+E: 展开/折叠工具调用
      if (e.name === "e" && e.shift) {
        e.preventDefault()
        toggleToolCallExpanded()
        return
      }

      // Ctrl+B / Ctrl+F: 后退/前进 1 字符
      if (e.name === "b" && !e.shift) {
        e.preventDefault()
        input.moveCursorLeft()
        return
      }
      if (e.name === "f" && !e.shift) {
        e.preventDefault()
        input.moveCursorRight()
        return
      }

      // Ctrl+D: 删除光标后 1 字符
      if (e.name === "d") {
        e.preventDefault()
        if (hasSelection) {
          input.deleteSelection()
        } else {
          input.moveCursorRight()
          input.deleteSelection()
        }
        return
      }

      // Ctrl+H: 等价 Backspace
      if (e.name === "h") {
        e.preventDefault()
        if (hasSelection) {
          input.deleteSelection()
        } else {
          input.deleteCharBackward()
        }
        return
      }

      // Ctrl+W: 删除前一个单词
      if (e.name === "w") {
        e.preventDefault()
        if (hasSelection) {
          input.deleteSelection()
        } else {
          input.deleteWordBackward()
        }
        return
      }

      // Ctrl+K: 删除到行尾
      if (e.name === "k") {
        e.preventDefault()
        input.deleteToLineEnd()
        return
      }

      // Ctrl+U: 删除到行首
      if (e.name === "u") {
        e.preventDefault()
        input.deleteToLineStart()
        return
      }

      // Ctrl+L: 清空输入框
      if (e.name === "l") {
        e.preventDefault()
        input.clear()
        input.cursorOffset = 0
        return
      }

      // Ctrl+Home: 移到文本开头
      if (e.name === "home") {
        e.preventDefault()
        if (hasSelection) input.clearSelection()
        input.gotoBufferHome()
        return
      }

      // Ctrl+End: 移到文本结尾
      if (e.name === "end") {
        e.preventDefault()
        if (hasSelection) input.clearSelection()
        input.gotoBufferEnd()
        return
      }

      // Ctrl+← / Ctrl+→: 按单词跳转
      if (e.name === "left") {
        e.preventDefault()
        input.moveWordBackward()
        return
      }
      if (e.name === "right") {
        e.preventDefault()
        input.moveWordForward()
        return
      }

      // Shift+Ctrl+← / Shift+Ctrl+→: 按单词选择
      if (e.name === "left" && e.shift) {
        e.preventDefault()
        input.moveWordBackward({ select: true })
        return
      }
      if (e.name === "right" && e.shift) {
        e.preventDefault()
        input.moveWordForward({ select: true })
        return
      }

      return
    }

    // ─── Alt 修饰键 (opentui 把 Alt 映射到 meta) ──────────
    if (e.meta) {
      // Alt+B / Alt+F: 按单词跳转
      if (e.name === "b") {
        e.preventDefault()
        input.moveWordBackward()
        return
      }
      if (e.name === "f") {
        e.preventDefault()
        input.moveWordForward()
        return
      }

      // Alt+Backspace: 删除前一个单词
      if (e.name === "backspace") {
        e.preventDefault()
        if (hasSelection) {
          input.deleteSelection()
        } else {
          input.deleteWordBackward()
        }
        return
      }

      // Alt+D: 删除后一个单词
      if (e.name === "d") {
        e.preventDefault()
        input.deleteWordForward()
        return
      }

      return
    }

    // ─── Shift 修饰键 ─────────────────────────────────────
    if (e.shift) {
      // Shift+← / Shift+→: 选择 1 字符
      if (e.name === "left") {
        e.preventDefault()
        input.moveCursorLeft({ select: true })
        return
      }
      if (e.name === "right") {
        e.preventDefault()
        input.moveCursorRight({ select: true })
        return
      }

      // Shift+Home: 选择到行首
      if (e.name === "home") {
        e.preventDefault()
        input.gotoLineHome({ select: true })
        return
      }

      // Shift+End: 选择到行尾
      if (e.name === "end") {
        e.preventDefault()
        input.gotoLineEnd({ select: true })
        return
      }

      return
    }

    // ─── 无修饰键 ─────────────────────────────────────────

    // Home / End: 移动光标
    if (e.name === "home") {
      e.preventDefault()
      if (hasSelection) input.clearSelection()
      input.gotoLineHome()
      return
    }
    if (e.name === "end") {
      e.preventDefault()
      if (hasSelection) input.clearSelection()
      input.gotoLineEnd()
      return
    }

    // Tab: 插入 2 个空格
    if (e.name === "tab") {
      e.preventDefault()
      input.insertText('  ')
      return
    }

    // 弹框打开时，让出 up/down/return 给外层 useKeyboard 处理
    if (props.popupOpen && (e.name === "up" || e.name === "down" || e.name === "return")) {
      return
    }

    // Up/Down: 翻历史
    if (e.name === "up" && (input.plainText.length === 0 || input.cursorOffset === 0)) {
      e.preventDefault()
      const prev = history.up()
      if (prev !== undefined) input.setText(prev)
      return
    }

    if (e.name === "down" && (input.plainText.length === 0 || input.cursorOffset >= input.plainText.length)) {
      e.preventDefault()
      input.setText(history.down() ?? "")
      return
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
