import { createContext, useContext, For, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"

interface DialogItem {
  id: number
  render: () => JSX.Element
}

export interface DialogContext {
  stack: DialogItem[]
  replace: (render: () => JSX.Element) => void
  clear: () => void
}

let nextId = 0

const Ctx = createContext<DialogContext>()

export function DialogProvider(props: { children: JSX.Element }) {
  const [stack, setStack] = createStore<DialogItem[]>([])

  const api: DialogContext = {
    get stack() { return stack },
    replace: (render) => setStack([{ id: nextId++, render }]),
    clear: () => setStack([]),
  }

  return (
    <Ctx.Provider value={api}>
      {props.children}
      <Show when={stack.length > 0}>
        <For each={stack}>
          {(item) => <item.render />}
        </For>
      </Show>
    </Ctx.Provider>
  )
}

export function useDialog(): DialogContext {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useDialog: missing DialogProvider")
  return ctx
}
