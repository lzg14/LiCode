import { createMemo } from "solid-js"
import { useTheme } from "../context/theme"
import { useLoop } from "../context/loop"
import { globalToolRegistry } from "../../tools/registry"
import { estimateCost, formatCost } from "../../llm/cost"

export function StatusBar() {
  const { textMuted } = useTheme()
  const { elapsed, isProcessing, currentModel, llmTokenUsage } = useLoop()

  const elapsedStr = () => {
    const secs = elapsed()
    if (secs < 60) return `${secs}s`
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return `${m}m${s}s`
  }

  const costStr = createMemo(() => {
    const usage = llmTokenUsage()
    if (!usage.input && !usage.output) return ''
    const cost = estimateCost(currentModel(), usage.input, usage.output)
    return ` · ${formatCost(cost.totalCost)}`
  })

  const tokenStr = () => {
    const usage = llmTokenUsage()
    if (!usage.input && !usage.output) return ''
    return ` · ↑${(usage.input / 1000).toFixed(1)}K ↓${(usage.output / 1000).toFixed(1)}K`
  }

  return (
    <box width="100%" paddingX={1} paddingY={0}>
      <text fg={textMuted()}>
        {`${globalToolRegistry.list().length} tools · ${currentModel()}`}
        {tokenStr()}{costStr()}
        {isProcessing() ? ` · ${elapsedStr()}` : ""}
      </text>
    </box>
  )
}
