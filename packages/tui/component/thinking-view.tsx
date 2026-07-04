import type { SyntaxStyle } from '@opentui/core'
import { useTheme } from '../context/theme'
import { createMarkdownSyntaxStyle } from '../util/syntax-style'
import type { ThinkingDisplay } from '../util/thinking-display'

function MarkdownTextInline(props: { content: string; streaming?: boolean; syntaxStyle?: SyntaxStyle }) {
  const { primary, warning, success, info, text, textMuted, background, border } = useTheme()
  // 兜底：调用方没传 syntaxStyle 时自己创建一个
  const fallbackSyntaxStyle = createMarkdownSyntaxStyle({
    primary: primary(), warning: warning(), success: success(),
    info: info(), text: text(), textMuted: textMuted(), border: border(),
  })
  return (
    <markdown
      content={props.content}
      streaming={props.streaming ?? false}
      syntaxStyle={props.syntaxStyle ?? fallbackSyntaxStyle}
      conceal={true}
      fg={text()}
      bg={background()}
    />
  )
}

export function ThinkingView(props: {
  display: ThinkingDisplay
  streaming?: boolean
  syntaxStyle?: SyntaxStyle
}) {
  if (props.display.kind === 'empty') return null

  // 思考内容不显示，只显示正式输出
  if (props.display.kind === 'thinking-only') return null

  if (props.display.kind === 'has-rest') {
    return (
      <box marginBottom={1}>
        <MarkdownTextInline content={props.display.rest} streaming={props.streaming ?? false} syntaxStyle={props.syntaxStyle} />
      </box>
    )
  }

  if (props.display.kind === 'no-thinking') {
    if (!props.display.rest) return null
    return (
      <box marginBottom={1}>
        <MarkdownTextInline content={props.display.rest} streaming={props.streaming ?? false} syntaxStyle={props.syntaxStyle} />
      </box>
    )
  }

  return null
}
