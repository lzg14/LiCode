import { createContext, useContext, createSignal, createMemo, type JSX, type Accessor } from "solid-js"
import defaultTheme from "../theme/default.json"

export type ThemeColors = Record<string, string>

export interface ThemeContext {
  colors: Accessor<ThemeColors>
  mode: Accessor<"dark" | "light">
  setMode: (mode: "dark" | "light") => void
  primary: Accessor<string>
  error: Accessor<string>
  warning: Accessor<string>
  success: Accessor<string>
  info: Accessor<string>
  text: Accessor<string>
  textMuted: Accessor<string>
  background: Accessor<string>
  backgroundPanel: Accessor<string>
  backgroundElement: Accessor<string>
  border: Accessor<string>
  borderActive: Accessor<string>
}

const Ctx = createContext<ThemeContext>()

export function ThemeProvider(props: { children: JSX.Element; initialMode?: "dark" | "light" }) {
  const [mode, setMode] = createSignal<"dark" | "light">(props.initialMode ?? "dark")
  const colors = createMemo(() => {
    const t = defaultTheme.theme as Record<string, string>
    const result: Record<string, string> = {}
    for (const [key, value] of Object.entries(t)) {
      result[key] = value
    }
    return result
  })

  const value: ThemeContext = {
    colors,
    mode,
    setMode,
    primary: () => colors().primary,
    error: () => colors().error,
    warning: () => colors().warning,
    success: () => colors().success,
    info: () => colors().info,
    text: () => colors().text,
    textMuted: () => colors().textMuted,
    background: () => colors().background,
    backgroundPanel: () => colors().backgroundPanel,
    backgroundElement: () => colors().backgroundElement,
    border: () => colors().border,
    borderActive: () => colors().borderActive,
  }
  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>
}

export function useTheme(): ThemeContext {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useTheme: missing ThemeProvider")
  return ctx
}
