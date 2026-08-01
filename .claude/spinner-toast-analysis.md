# Spinner 动画和 Toast 内存泄漏分析

## 1. Spinner 动画问题

### 文件位置
packages/tui/component/spinner.tsx

### 文件是否存在
是

### 问题概要
当前 Spinner 组件**没有动画效果**。它只是静态显示一个 Braille 字符（⠋），而不是循环切换帧来产生动画效果。

### 具体问题位置
- **第4行**：定义了10个动画帧 rames
- **第12行**：只显示 rames[0]（第一个字符），没有定时器或状态更新来切换帧

### 问题分析
1. 缺少 createSignal 来管理当前帧索引
2. 缺少 setInterval 或 setTimeout 来定期更新帧索引
3. 组件没有实现动画循环逻辑
4. 没有清理定时器的逻辑（onCleanup）

### 修复方案
`	sx
import { createSignal, onCleanup, type JSX } from "solid-js"
import { useTheme } from "../context/theme"

const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

export function Spinner(props: { children?: JSX.Element; color?: string }) {
  const { textMuted } = useTheme()
  const color = props.color ?? textMuted()
  const [frameIndex, setFrameIndex] = createSignal(0)

  const interval = setInterval(() => {
    setFrameIndex((prev) => (prev + 1) % frames.length)
  }, 80)

  onCleanup(() => clearInterval(interval))

  return (
    <box flexDirection="row" gap={1}>
      <text fg={color}>{frames[frameIndex()]}</text>
      {props.children && <text fg={color}>{props.children}</text>}
    </box>
  )
}
`

**可行性**：✅ 可行，这是标准的动画实现方式。

## 2. Toast 内存泄漏问题

### 文件位置
packages/tui/ui/toast.tsx

### 文件是否存在
是

### 问题概要
ToastProvider 组件中的 setTimeout 定时器**没有在组件卸载时清理**，导致内存泄漏。

### 具体问题位置
- **第26行**：定义了 	imeoutHandle 变量
- **第34行**：设置 setTimeout，但没有在组件卸载时清除
- **第44-47行**：ToastProvider 组件没有 onCleanup 逻辑

### 问题分析
1. 	imeoutHandle 在组件生命周期外被管理
2. 当 ToastProvider 卸载时，定时器仍然运行
3. 定时器回调尝试更新已卸载组件的状态，可能导致：
   - 内存泄漏（定时器引用未释放）
   - 潜在的运行时错误（更新已卸载组件）
   - 多个定时器同时运行（每次 init() 调用都创建新的定时器）

### 修复方案
`	sx
import { createContext, type ParentProps, onCleanup, Show, useContext } from "solid-js"
import { createStore } from "solid-js/store"
import { SplitBorder } from "../component/border"
import { useTheme } from "../context/theme"

export interface ToastOptions {
  message: string
  variant?: "info" | "success" | "warning" | "error"
  title?: string
  duration?: number
}

export interface ToastContext {
  currentToast: ToastOptions | null
  show: (options: ToastOptions) => void
  error: (err: unknown) => void
}

const ctx = createContext<ToastContext>()

function init() {
  const [store, setStore] = createStore({
    currentToast: null as ToastOptions | null,
  })

  let timeoutHandle: ReturnType<typeof setTimeout> | null = null

  const cleanup = () => {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle)
      timeoutHandle = null
    }
  }

  const toast: ToastContext = {
    get currentToast() { return store.currentToast },
    show(options: ToastOptions) {
      cleanup() // 清除之前的定时器
      const { duration = 5000, ...currentToast } = options
      setStore("currentToast", currentToast)
      timeoutHandle = setTimeout(() => setStore("currentToast", null), duration)
    },
    error: (err: unknown) => {
      if (err instanceof Error) return toast.show({ message: err.message, variant: "error" })
      toast.show({ message: String(err), variant: "error" })
    },
  }
  return { toast, cleanup }
}

export function ToastProvider(props: ParentProps) {
  const { toast, cleanup } = init()
  
  onCleanup(() => cleanup())
  
  return <ctx.Provider value={toast}>{props.children}</ctx.Provider>
}

export function useToast() {
  const value = useContext(ctx)
  if (!value) throw new Error("useToast: missing ToastProvider")
  return value
}

// Toast 组件保持不变...
`

**可行性**：✅ 可行，通过 onCleanup 确保定时器在组件卸载时被清除。

## 总结

| 问题 | 严重程度 | 修复难度 | 修复方案 |
|------|----------|----------|----------|
| Spinner 无动画 | 中 | 低 | 添加 createSignal + setInterval + onCleanup |
| Toast 内存泄漏 | 高 | 低 | 在 ToastProvider 中添加 onCleanup 清理定时器 |

两个问题都是常见的 SolidJS 生命周期管理问题，修复方案成熟可靠。

---
*分析时间：2026-07-31*
*分析工具：Claude Code*
