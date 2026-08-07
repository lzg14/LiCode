import { createMemo, For, Show } from "solid-js"
import { useTheme } from "../context/theme"

export interface SlashItem {
  type: 'cmd' | 'skill'
  label: string
  desc: string
  usage?: string
}

interface SlashMenuProps {
  open: boolean
  query: string
  items: SlashItem[]
  selectedIndex: number
}

export function fuzzyMatch(query: string, target: string): { score: number; indices: number[] } | null {
  if (!query) return { score: Infinity, indices: [] }
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  let qi = 0, score = 0, prevMatch = false
  const indices: number[] = []
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      indices.push(ti)
      score += prevMatch ? 10 : 3
      if (ti === 0 || t[ti - 1] === '/' || t[ti - 1] === '-' || t[ti - 1] === ' ' || t[ti - 1] === '_') score += 7
      prevMatch = true
      qi++
    } else {
      prevMatch = false
    }
  }
  if (qi !== q.length) return null
  score -= indices[0] * 0.5
  return { score, indices }
}

function MatchedLabel(props: { label: string; indices: number[]; fg: string; matchFg: string }) {
  if (props.indices.length === 0) return <text fg={props.fg}>{props.label}</text>
  const chars: { ch: string; matched: boolean }[] = []
  let ip = 0
  for (let i = 0; i < props.label.length; i++) {
    if (ip < props.indices.length && i === props.indices[ip]) {
      chars.push({ ch: props.label[i], matched: true })
      ip++
    } else {
      chars.push({ ch: props.label[i], matched: false })
    }
  }
  return (
    <box flexDirection="row">
      <For each={chars}>
        {(c) => <text fg={c.matched ? props.matchFg : props.fg}>{c.ch}</text>}
      </For>
    </box>
  )
}

export function SlashMenu(props: SlashMenuProps) {
  const { primary, text, textMuted } = useTheme()

  const filter = createMemo(() => props.query.slice(1))

  const itemsWithHL = createMemo(() =>
    props.items.map(item => ({
      item,
      indices: fuzzyMatch(filter(), item.label)?.indices ?? [],
    }))
  )

  if (!props.open) return null

  return (
    <box flexDirection="column" width="100%" paddingX={2} flexShrink={0}>
      <Show when={itemsWithHL().length === 0}>
        <text fg={textMuted()}>  无匹配结果</text>
      </Show>
      <For each={itemsWithHL()}>
        {(entry, i) => {
          const isSelected = i() === props.selectedIndex
          return (
            <box flexDirection="row">
              <text fg={isSelected ? primary() : textMuted()}>{isSelected ? '▸ ' : '  '}</text>
              <MatchedLabel
                label={entry.item.label}
                indices={entry.indices}
                fg={isSelected ? primary() : text()}
                matchFg={primary()}
              />
              <text>  </text>
              <text fg={isSelected ? primary() : textMuted()}>{entry.item.desc}</text>
              <Show when={entry.item.usage}>
                <text fg={textMuted()}> — {entry.item.usage}</text>
              </Show>
            </box>
          )
        }}
      </For>
    </box>
  )
}
