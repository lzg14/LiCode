import { createSignal, Show } from 'solid-js'
import type { SyntaxStyle } from '@opentui/core'
import { useTheme } from '../context/theme'
import type { ThinkingDisplay } from '../util/thinking-display'
import { StaticMarkdown } from './static-markdown'

/**
 * ThinkingView - 渲染 assistant 消息的 thinking 块
 *
 * 三种状态：
 * - thinking-only：只有 thinking 没有正文 → 完整渲染 thinking（用灰色 markdown）
 * - has-rest：thinking + 正文都存在 → thinking 始终显示（折叠前 5 行预览，完整 markdown）
 * - no-thinking：没 thinking → 只渲染正文
 *
 * 用户体验：等待长 LLM 回复时能看到模型在思考什么（解决 "等太久没动静" 的焦虑）
 *
 * 注：box 不支持 onClick，折叠/展开留给后续加 hotkey 实现
 */
export function ThinkingView(props: {
  display: ThinkingDisplay
  streaming?: boolean
  syntaxStyle?: SyntaxStyle
  /** 可选：完整 message，用于 msg 模式（cache 到 message 对象，历史永不重 parse） */
  msg?: { content: string; tokens?: unknown; _cachedContent?: string; styledText?: unknown }
}) {
  const { textMuted } = useTheme()
  // 预留 hotkey 折叠状态（暂时不接交互）
  const [thinkingCollapsed, _setThinkingCollapsed] = createSignal(false)

  if (props.display.kind === 'empty') return null

  // 只有 thinking（无正文）：完整渲染 thinking
  if (props.display.kind === 'thinking-only') {
    return (
      <box flexDirection="column" marginBottom={1} paddingLeft={1} border={["left"]} borderColor={textMuted()}>
        <text fg={textMuted()}>{"💭 思考过程"}</text>
        <StaticMarkdown
          msg={props.msg as never}
          content={props.display.text}
          syntaxStyle={props.syntaxStyle}
        />
      </box>
    )
  }

  if (props.display.kind === 'has-rest') {
    const thinkingLines = props.display.thinking.split('\n')
    const isLong = thinkingLines.length > 5
    return (
      <box flexDirection="column" marginBottom={1}>
        {/* thinking 块：左边框 + 灰色 markdown，长文显示前 5 行 + 提示 */}
        <box flexDirection="column" paddingLeft={1} border={["left"]} borderColor={textMuted()}>
          <text fg={textMuted()}>{"💭 思考过程"}</text>
          <Show
            when={!thinkingCollapsed() || !isLong}
            fallback={
              <text fg={textMuted()}>
                {thinkingLines.slice(0, 5).join('\n')}
                {isLong ? `\n  ⋮ (共 ${thinkingLines.length} 行)` : ''}
              </text>
            }
          >
            <StaticMarkdown
              msg={props.msg as never}
              content={props.display.thinking}
              syntaxStyle={props.syntaxStyle}
            />
          </Show>
        </box>
        {/* 正文：完整 markdown 渲染（无 flicker，因为 <StaticMarkdown> 内部用 cache） */}
        <box marginTop={1}>
          <StaticMarkdown
            msg={props.msg as never}
            content={props.display.rest}
            syntaxStyle={props.syntaxStyle}
          />
        </box>
      </box>
    )
  }

  if (props.display.kind === 'no-thinking') {
    if (!props.display.rest) return null
    return (
      <box marginBottom={1}>
        <StaticMarkdown
          msg={props.msg as never}
          content={props.display.rest}
          syntaxStyle={props.syntaxStyle}
        />
      </box>
    )
  }

  return null
}
