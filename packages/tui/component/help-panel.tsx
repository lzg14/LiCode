import { For } from "solid-js"
import { HELP_CONTENT } from '../util/help-content'
import { useTheme } from '../context/theme'

export function HelpPanel(props: { onClose: () => void }) {
  const { primary, text, textMuted, backgroundPanel, borderActive } = useTheme()

  return (
    <box
      flexDirection="column"
      position="absolute"
      top={0}
      left={0}
      width="100%"
      height="100%"
      zIndex={5000}
      alignItems="center"
      justifyContent="center"
    >
      <box
        flexDirection="column"
        width={60}
        maxHeight="80%"
        paddingX={2}
        paddingY={1}
        backgroundColor={backgroundPanel()}
        border={['top', 'bottom', 'left', 'right']}
        borderColor={borderActive()}
      >
        <text fg={primary()}>  帮助 (↑↓ 滚动, Esc 关闭)</text>
        <box height={1} />
        <scrollbox flexGrow={1} scrollY>
          <For each={HELP_CONTENT}>
            {(section) => (
              <box flexDirection="column" marginBottom={1}>
                <text fg={primary()}>{`## ${section.title}`}</text>
                <For each={section.entries}>
                  {(entry) => (
                    <box flexDirection="row" paddingLeft={2}>
                      <text fg={text()} style={{ width: 24 }}>{entry.keys.padEnd(24)}</text>
                      <text fg={textMuted()}>{entry.desc}</text>
                    </box>
                  )}
                </For>
              </box>
            )}
          </For>
        </scrollbox>
        <box height={1} />
        <text fg={textMuted()}>按 Esc 或 F1 关闭</text>
      </box>
    </box>
  )
}
