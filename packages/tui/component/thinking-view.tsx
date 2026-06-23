import { Show } from 'solid-js'
import { useTheme } from '../context/theme'
import { createMarkdownSyntaxStyle } from '../util/syntax-style'
import type { ThinkingDisplay } from '../util/thinking-display'
import { CollapsibleText } from './collapsible-text'

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
      <box flexDirection="column" marginBottom={1} paddingLeft={1}>
        <text fg={textMuted()}>┄ 思考过程 ┄</text>
        <CollapsibleText content={props.display.text || ''} maxLines={5} />
      </box>
    )
  }

  if (props.display.kind === 'has-rest') {
    return (
      <box flexDirection="column">
        <Show when={props.display.thinking}>
          <box flexDirection="column" marginBottom={1} paddingLeft={1}>
            <text fg={textMuted()}>┄ 思考过程 ┄</text>
            <CollapsibleText content={props.display.thinking!} maxLines={5} />
          </box>
        </Show>
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
