/**
 * 简单的 Markdown 文本高亮渲染器
 * 在终端中用 ANSI 转义码为不同内容着色
 */

export const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
}

/**
 * 渲染 Markdown 文本为带颜色的终端输出
 */
export function renderMarkdown(text: string): string {
  const lines = text.split('\n')
  const rendered: string[] = []

  for (const line of lines) {
    // 标题
    if (line.startsWith('# ')) {
      rendered.push(`${c.bold}${c.brightBlue}${line.slice(2)}${c.reset}`)
      continue
    }
    if (line.startsWith('## ')) {
      rendered.push(`${c.bold}${c.blue}${line.slice(3)}${c.reset}`)
      continue
    }
    if (line.startsWith('### ')) {
      rendered.push(`${c.bold}${c.cyan}${line.slice(4)}${c.reset}`)
      continue
    }

    // 列表项
    if (line.match(/^[-*]\s/)) {
      rendered.push(`${c.cyan}•${c.reset} ${renderInline(line.slice(2))}`)
      continue
    }
    if (line.match(/^\d+\.\s/)) {
      const match = line.match(/^(\d+\.\s)(.*)/)
      if (match) {
        rendered.push(`${c.cyan}${match[1]}${c.reset} ${renderInline(match[2])}`)
        continue
      }
    }

    // 引用
    if (line.startsWith('> ')) {
      rendered.push(`${c.gray}${c.italic}  ${line.slice(2)}${c.reset}`)
      continue
    }

    // 分割线
    if (line.match(/^[-*_]{3,}$/)) {
      rendered.push(`${c.gray}${'─'.repeat(40)}${c.reset}`)
      continue
    }

    // 代码块
    if (line.startsWith('```')) {
      rendered.push(`${c.gray}${line}${c.reset}`)
      continue
    }

    // 普通行
    rendered.push(renderInline(line))
  }

  return rendered.join('\n')
}

/**
 * 渲染行内元素
 */
function renderInline(text: string): string {
  // 粗体 **text** 或 __text__
  text = text.replace(/\*\*(.+?)\*\*/g, `${c.bold}${c.brightYellow}$1${c.reset}`)
  text = text.replace(/__(.+?)__/g, `${c.bold}${c.brightYellow}$1${c.reset}`)

  // 斜体 *text* 或 _text_
  text = text.replace(/\*(.+?)\*/g, `${c.italic}${c.yellow}$1${c.reset}`)
  text = text.replace(/_(.+?)_/g, `${c.italic}${c.yellow}$1${c.reset}`)

  // 行内代码 `code`
  text = text.replace(/`([^`]+)`/g, `${c.green}$1${c.reset}`)

  // 链接 [text](url)
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, `${c.cyan}$1${c.reset} ${c.gray}($2)${c.reset}`)

  // 文件路径
  text = text.replace(/([\/\\][\w\-\.\/\\]+\.\w+)/g, `${c.brightGreen}$1${c.reset}`)

  // 数字
  text = text.replace(/\b(\d+)\b/g, `${c.brightMagenta}$1${c.reset}`)

  return text
}

/**
 * 渲染错误消息
 */
export function renderError(text: string): string {
  return `${c.red}${c.bold}✗${c.reset} ${c.red}${text}${c.reset}`
}

/**
 * 渲染成功消息
 */
export function renderSuccess(text: string): string {
  return `${c.green}${c.bold}✓${c.reset} ${c.green}${text}${c.reset}`
}

/**
 * 渲染警告消息
 */
export function renderWarning(text: string): string {
  return `${c.yellow}${c.bold}!${c.reset} ${c.yellow}${text}${c.reset}`
}

/**
 * 渲染信息消息
 */
export function renderInfo(text: string): string {
  return `${c.cyan}${c.bold}ℹ${c.reset} ${c.cyan}${text}${c.reset}`
}

/**
 * 渲染代码块
 */
export function renderCodeBlock(code: string, language?: string): string {
  const lines = code.split('\n')
  const rendered: string[] = []

  // 语言标签
  if (language) {
    rendered.push(`${c.gray}${language}${c.reset}`)
  }

  // 代码内容
  for (const line of lines) {
    rendered.push(`${c.green}${line}${c.reset}`)
  }

  return rendered.join('\n')
}

/**
 * 渲染 Diff
 */
export function renderDiff(diff: string): string {
  return diff.split('\n').map(line => {
    if (line.startsWith('+')) {
      return `${c.green}${line}${c.reset}`
    }
    if (line.startsWith('-')) {
      return `${c.red}${line}${c.reset}`
    }
    if (line.startsWith('@@')) {
      return `${c.cyan}${line}${c.reset}`
    }
    return line
  }).join('\n')
}
