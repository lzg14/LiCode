import { Show } from 'solid-js'
import { useTheme } from '../context/theme'
import { createMarkdownSyntaxStyle } from '../util/syntax-style'
import type { ThinkingDisplay } from '../util/thinking-display'

function MarkdownTextInline(props: { content: string; streaming?: boolean }) {
  const { primary, warning, success, info, text, textMuted, background, border } = useTheme()
  const syntaxStyle = createMarkdownSyntaxStyle({
    primary: primary(), warning: warning(), success: success(),
    info: info(), text: text(), textMuted: textMuted(), border: border(),
  })
  return (
    <markdown
      content={props.content}
      streaming={props.streaming ?? false}
      syntaxStyle={syntaxStyle}
      fg={text()}
      bg={background()}
    />
  )
}

export function ThinkingView(props: {
  display: ThinkingDisplay
  streaming?: boolean
}) {
  const { textMuted } = useTheme()

  if (props.display.kind === 'empty') return null

  if (props.display.kind === 'thinking-only') {
    return (
      <box
        marginBottom={1}
        flexDirection="column"
        paddingLeft={1}
        borderStyle="rounded"
        borderColor={textMuted()}
      >
        <text fg={textMuted()}>💭 thinking...</text>
      </box>
    )
  }

  const rest = props.display.kind === 'has-rest'
    ? props.display.rest
    : props.display.kind === 'no-thinking'
      ? props.display.rest
      : ''

  if (!rest) return null

  return (
    <box marginBottom={1}>
      <MarkdownTextInline content={rest} streaming={props.streaming ?? false} />
    </box>
  )
}
