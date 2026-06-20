import { createSignal } from "solid-js"

// 全局快捷键信号 — app.tsx 触发，home.tsx 消费
export const [sidebarVisible, setSidebarVisible] = createSignal(true)
export const [modelPickerOpen, setModelPickerOpen] = createSignal(false)
