import { createContext, useContext, type JSX } from "solid-js"

export interface KeyBinding {
  key: string
  ctrl?: boolean
  meta?: boolean
  shift?: boolean
}

export interface KeybindContext {
  match: (action: string, event: { name: string; ctrl: boolean; meta: boolean; shift: boolean }) => boolean
  register: (action: string, keys: KeyBinding) => void
}

const Ctx = createContext<KeybindContext>()

export function KeybindProvider(props: { children: JSX.Element }) {
  const bindings = new Map<string, KeyBinding>()

  const register = (action: string, keys: KeyBinding) => {
    bindings.set(action, keys)
  }

  const match = (action: string, event: { name: string; ctrl: boolean; meta: boolean; shift: boolean }) => {
    const binding = bindings.get(action)
    if (!binding) return false
    return (
      event.name === binding.key &&
      event.ctrl === (binding.ctrl ?? false) &&
      event.meta === (binding.meta ?? false) &&
      event.shift === (binding.shift ?? false)
    )
  }

  const value: KeybindContext = { match, register }
  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>
}

export function useKeybind(): KeybindContext {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useKeybind: missing KeybindProvider")
  return ctx
}
