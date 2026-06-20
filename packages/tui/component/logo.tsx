import { For } from "solid-js"
import { useTheme } from "../context/theme"

const LOGO_ART = [
  "__    __   ___   ___   ____    ____",
  "||    ||  //    // \\\\  || \\\\  ||   ",
  "||    || ((    ((   )) ||  )) ||== ",
  "||__| ||  \\\\__  \\\\_//  ||_//  ||___",
]

export function Logo() {
  const { primary, textMuted } = useTheme()

  return (
    <box flexDirection="column" alignItems="center" paddingTop={1} paddingBottom={1}>
      <For each={LOGO_ART}>
        {(line) => <text fg={primary()}>{line}</text>}
      </For>
      <text fg={textMuted()}>谋定而后动</text>
    </box>
  )
}
