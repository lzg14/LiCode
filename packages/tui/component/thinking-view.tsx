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
      <box marginBottom={1} paddingLeft={1}>
        <text fg={textMuted()}>{props.display.text || 'thinking...'}</text>
      </box>
    )
  }

  if (props.display.kind === 'has-rest') {
    // thinking + 正文：thinking 用灰色，正文用正常高亮
    return (
      <box flexDirection="column">
        {props.display.thinking && (
          <box marginBottom={1} paddingLeft={1}>
            <text fg={textMuted()}>{props.display.thinking}</text>
          </box>
        )}
        <MarkdownTextInline content={props.display.rest} streaming={props.streaming ?? false} />
      </box>
    )
  }

  if (props.display.kind === 'no-thinking') {
    if (!props.display.rest) return null
    return (
      <box marginBottom={1}>
        <MarkdownTextInline content={props.display.rest} streaming={props.streaming ?? false} />
      </box>
    )
  }

  return null
}
