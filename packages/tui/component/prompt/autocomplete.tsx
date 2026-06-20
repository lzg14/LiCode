import { createMemo, createSignal } from "solid-js"

export interface AutocompleteItem {
  label: string
  value: string
  description?: string
}

export function useAutocomplete(suggestions: () => AutocompleteItem[]) {
  const [query, setQuery] = createSignal("")
  const [selectedIdx, setSelectedIdx] = createSignal(0)

  const filtered = createMemo(() => {
    const q = query().toLowerCase()
    if (!q) return suggestions()
    return suggestions().filter(
      (s) => s.label.toLowerCase().includes(q) || s.value.toLowerCase().includes(q)
    )
  })

  const selectNext = () => {
    setSelectedIdx((i) => Math.min(i + 1, filtered().length - 1))
  }

  const selectPrev = () => {
    setSelectedIdx((i) => Math.max(i - 1, 0))
  }

  const selected = createMemo(() => filtered()[selectedIdx()])

  return {
    query,
    setQuery,
    filtered,
    selectedIdx,
    setSelectedIdx,
    selectNext,
    selectPrev,
    selected,
  }
}
