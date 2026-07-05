import { createMemo } from "solid-js"
import { estimateCost, formatCost } from "../../llm/cost"
import { globalToolRegistry } from "../../tools/registry"
import { useLoop } from "../context/loop"
import { useTheme } from "../context/theme"

export function StatusBar() {
  const { textMuted, success } = useTheme()
  const { elapsed, isProcessing, currentModel, llmTokenUsage, subagentStatuses } = useLoop()

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

  // L1: subagent 状态（底部常驻，F2 看详情）
  const subagentStr = createMemo(() => {
    const all = subagentStatuses()
    if (all.length === 0) return ''
    const running = all.filter((s) => s.status === 'running').length
    const total = all.length
    return ` · 🧠 ${running} running / ${total} total`
  })

  return (
    <box width="100%" paddingX={1} paddingY={0}>
      <text fg={textMuted()}>
        {`${globalToolRegistry.list().length} tools · ${currentModel()}`}
        {subagentStr()}{tokenStr()}{costStr()}
        {isProcessing() ? ` · ${elapsedStr()}` : ""}
      </text>
    </box>
  )
}
