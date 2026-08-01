import { For, Show } from "solid-js"
import type { SkillIndex } from "../../skills/types"
import { useTheme } from "../context/theme"

interface SkillSuggestProps {
  skills: SkillIndex[]
  selectedIndex: number
}

export function SkillSuggest(props: SkillSuggestProps) {
  const { backgroundPanel, primary, text, textMuted } = useTheme()

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
    >
      <text fg={primary()}>🎯 检测到相关技能</text>
      <box height={1} />
      <For each={props.skills}>
        {(skill, i) => (
          <box
            flexDirection="column"
            backgroundColor={i() === props.selectedIndex ? primary() : undefined}
          >
            <box flexDirection="row">
              <text fg={i() === props.selectedIndex ? backgroundPanel() : text()}>
                {i() === props.selectedIndex ? '▶ ' : '  '}
                {skill.name}
              </text>
              <text fg={i() === props.selectedIndex ? backgroundPanel() : textMuted()}>
                {' '}— {skill.description || '无描述'}
              </text>
            </box>
            <Show when={skill.triggerHints && i() === props.selectedIndex}>
              <text fg={i() === props.selectedIndex ? backgroundPanel() : textMuted()}>
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
