import { SyntaxStyle, RGBA } from "@opentui/core"

function hex(input: string): RGBA {
  let s = input.replace("#", "").trim()
  if (s.length === 3) s = s.split("").map(c => c + c).join("")
  const r = parseInt(s.substring(0, 2), 16) / 255
  const g = parseInt(s.substring(2, 4), 16) / 255
  const b = parseInt(s.substring(4, 6), 16) / 255
  return RGBA.fromValues(r, g, b, 1)
}

export function createMarkdownSyntaxStyle(theme: {
  primary: string
  warning: string
  success: string
  info: string
  text: string
  textMuted: string
  border: string
}): SyntaxStyle {
  return SyntaxStyle.fromTheme([
    { scope: ["markup.heading", "markup.heading.1", "markup.heading.2", "markup.heading.3", "markup.heading.4", "markup.heading.5", "markup.heading.6"], style: { foreground: hex(theme.primary), bold: true } },
    { scope: ["markup.bold", "markup.strong"], style: { foreground: hex(theme.warning), bold: true } },
    { scope: ["markup.italic"], style: { foreground: hex(theme.warning), italic: true } },
    { scope: ["markup.raw.inline", "markup.raw"], style: { foreground: hex(theme.success) } },
    { scope: ["markup.quote"], style: { foreground: hex(theme.textMuted), italic: true } },
    { scope: ["markup.link"], style: { foreground: hex(theme.info), underline: true } },
    { scope: ["markup.list", "markup.list.bullet", "markup.list.numbered"], style: { foreground: hex(theme.text) } },
    { scope: ["punctuation.special"], style: { foreground: hex(theme.textMuted) } },
    { scope: ["default"], style: { foreground: hex(theme.text) } },
  ])
}
