import type { JSX } from "solid-js"
import { createSignal, onCleanup, onMount } from "solid-js"
import { useTheme } from "../context/theme"

const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

export function Spinner(props: { children?: JSX.Element; color?: string }) {
  const { textMuted } = useTheme()
  const color = props.color ?? textMuted()
  const [frameIdx, setFrameIdx] = createSignal(0)

  onMount(() => {
    const id = setInterval(() => setFrameIdx(i => (i + 1) % frames.length), 80)
    onCleanup(() => clearInterval(id))
  })

  return (
    <box flexDirection="row" gap={1}>
      <text fg={color}>{frames[frameIdx()]}</text>
      {props.children && <text fg={color}>{props.children}</text>}
    </box>
  )
}
