import { createSignal, For, Show } from "solid-js"
import type { SkillIndex } from "../../skills/types"
import { useTheme } from "../context/theme"

interface SkillSuggestProps {
  skills: SkillIndex[]
  onConfirm: (skill: SkillIndex) => void
  onReject: () => void
}

export function SkillSuggest(props: SkillSuggestProps) {
  const { backgroundPanel, primary, text, textMuted, success, error } = useTheme()
  const [selectedIndex, setSelectedIndex] = createSignal(0)

  const handleKey = (e: any) => {
    const key = typeof e === 'string' ? e : e?.key
    if (key === 'up' || key === 'k') {
      setSelectedIndex(prev => Math.max(0, prev - 1))
    } else if (key === 'down' || key === 'j') {
      setSelectedIndex(prev => Math.min(props.skills.length - 1, prev + 1))
    } else if (key === 'return' || key === 'y') {
      const skill = props.skills[selectedIndex()]
      if (skill) props.onConfirm(skill)
    } else if (key === 'escape' || key === 'n') {
      props.onReject()
    }
  }

  if (props.skills.length === 0) return null

  return (
    <box
      flexDirection="column"
      width="100%"
      paddingX={2}
      paddingY={1}
      backgroundColor={backgroundPanel()}
      border={["top", "bottom", "left", "right"]}
      borderColor={primary()}
      onKeyDown={handleKey}
    >
      <text fg={primary()}>🎯 检测到相关技能</text>
      <box height={1} />
      <For each={props.skills}>
        {(skill, i) => (
          <box
            flexDirection="column"
            backgroundColor={i() === selectedIndex() ? primary() : undefined}
          >
            <box flexDirection="row">
              <text fg={i() === selectedIndex() ? backgroundPanel() : text()}>
                {i() === selectedIndex() ? '▶ ' : '  '}
                {skill.name}
              </text>
              <text fg={i() === selectedIndex() ? backgroundPanel() : textMuted()}>
                {' '}— {skill.description || '无描述'}
              </text>
            </box>
            <Show when={skill.triggerHints && i() === selectedIndex()}>
              <text fg={i() === selectedIndex() ? backgroundPanel() : textMuted()}>
                {'    触发条件: '}{skill.triggerHints}
              </text>
            </Show>
          </box>
        )}
      </For>
      <box height={1} />
      <text fg={textMuted()}>
        [Enter/y] 激活  [Esc/n] 跳过  [↑↓] 选择
      </text>
    </box>
  )
}
