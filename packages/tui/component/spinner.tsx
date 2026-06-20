import { useTheme } from "../context/theme"
import type { JSX } from "solid-js"

const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

export function Spinner(props: { children?: JSX.Element; color?: string }) {
  const { textMuted } = useTheme()
  const color = props.color ?? textMuted()

  return (
    <box flexDirection="row" gap={1}>
      <text fg={color}>{frames[0]}</text>
      {props.children && <text fg={color}>{props.children}</text>}
    </box>
  )
}
