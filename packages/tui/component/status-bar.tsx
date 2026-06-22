import { createMemo } from "solid-js"
import { useTheme } from "../context/theme"
import { useLoop } from "../context/loop"
import { globalToolRegistry } from "../../tools/registry"

export function StatusBar() {
  const { textMuted } = useTheme()
  const { elapsed, isProcessing, currentModel } = useLoop()

  const elapsedStr = () => {
    const secs = elapsed()
    if (secs < 60) return `${secs}s`
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return `${m}m${s}s`
  }

  return (
    <box width="100%" paddingX={1} paddingY={0}>
      <text fg={textMuted()}>
        {`${globalToolRegistry.list().length} tools · ${currentModel()}`}
        {isProcessing() ? ` · ${elapsedStr()}` : ""}
      </text>
    </box>
  )
}
