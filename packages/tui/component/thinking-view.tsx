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
  if (props.display.kind === 'empty') return null

  // 思考内容不显示，只显示正式输出
  if (props.display.kind === 'thinking-only') return null

  if (props.display.kind === 'has-rest') {
    return (
      <box marginBottom={1}>
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
