import { useTheme } from "../context/theme"
import { useLoop } from "../context/loop"
import { globalToolRegistry } from "../../tools/registry"
import { getModelConfig } from "../../llm/catalog"

export function StatusBar() {
  const { textMuted, success, warning } = useTheme()
  const { elapsed, isProcessing, currentModel, llmTokenUsage } = useLoop()

  const elapsedStr = () => {
    const secs = elapsed()
    if (secs < 60) return `${secs}s`
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return `${m}m${s}s`
  }

  const tokenInfo = () => {
    const usage = llmTokenUsage()
    if (usage.total === 0) return null
    const modelConfig = getModelConfig(currentModel())
    const contextWindow = modelConfig?.contextWindow
    if (contextWindow) {
      const pct = Math.round((usage.total / contextWindow) * 100)
      return `${usage.total.toLocaleString()} tokens (${pct}%)`
    }
    return `${usage.total.toLocaleString()} tokens`
  }

  return (
    <box width="100%" paddingX={1} paddingY={0}>
      <text fg={textMuted()}>
        {`${globalToolRegistry.list().length} tools · ${currentModel()}`}
        {tokenInfo() ? ` · ${tokenInfo()}` : ""}
        {isProcessing() ? ` · ${elapsedStr()}` : ""}
      </text>
    </box>
  )
}
