import { createMemo, Show } from "solid-js"
import { useTheme } from "../context/theme"

interface CollapsibleTextProps {
  content: string
  maxLines?: number
  fg?: string
}

export function CollapsibleText(props: CollapsibleTextProps) {
  const { text: textColor, textMuted } = useTheme()
  const maxLines = props.maxLines ?? 10

  const lineCount = createMemo(() => props.content.split('\n').length)
  const isLong = createMemo(() => lineCount() > maxLines)

  const displayText = createMemo(() => {
    if (!isLong()) return props.content
    const lines = props.content.split('\n')
    return lines.slice(0, maxLines).join('\n')
  })

  return (
    <box flexDirection="column">
      <text fg={props.fg ?? textColor()}>{displayText()}</text>
      <Show when={isLong()}>
        <text fg={textMuted()}>{`  ... (剩余 ${lineCount() - maxLines} 行，共 ${lineCount()} 行)`}</text>
      </Show>
    </box>
  )
}
