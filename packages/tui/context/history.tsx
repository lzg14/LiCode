import { createContext, useContext, type JSX, type Accessor } from "solid-js"

export interface HistoryContext {
  list: Accessor<string[]>
  add: (input: string) => void
  up: () => string | undefined
  down: () => string | undefined
}

const Ctx = createContext<HistoryContext>()

export function HistoryProvider(props: { children: JSX.Element; maxSize?: number }) {
  const maxSize = props.maxSize ?? 50
  let items: string[] = []
  let idx = -1

  const add = (input: string) => {
    if (items[items.length - 1] === input) return
    items.push(input)
    if (items.length > maxSize) items = items.slice(-maxSize)
    idx = items.length
  }

  const up = (): string | undefined => {
    if (items.length === 0) return undefined
    if (idx > 0) idx--
    return items[idx]
  }

  const down = (): string => {
    if (idx >= items.length - 1) {
      idx = items.length
      return ''
    }
    idx++
    return items[idx] ?? ''
  }

  const value: HistoryContext = {
    list: () => [...items],
    add,
    up,
    down,
  }
  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>
}

export function useHistory(): HistoryContext {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useHistory: missing HistoryProvider")
  return ctx
}
