export interface HelpEntry {
  keys: string
  desc: string
}

export interface HelpSection {
  title: string
  entries: HelpEntry[]
}

export const HELP_CONTENT: HelpSection[] = [
  {
    title: '光标移动',
    entries: [
      { keys: '← / →', desc: '字符左/右' },
      { keys: 'Home / End', desc: '行首/行尾' },
      { keys: 'Ctrl+A / Ctrl+E', desc: '行首/行尾' },
      { keys: 'Ctrl+B / Ctrl+F', desc: '字符后/前' },
      { keys: 'Ctrl+← / Ctrl+→', desc: '单词跳转' },
      { keys: 'Alt+B / Alt+F', desc: '单词跳转' },
      { keys: 'Ctrl+Home / Ctrl+End', desc: '文本开头/结尾' },
    ],
  },
  {
    title: '选择',
    entries: [
      { keys: 'Shift+← / Shift+→', desc: '字符选择' },
      { keys: 'Shift+Home / Shift+End', desc: '选到行首/尾' },
      { keys: 'Shift+Ctrl+← / Shift+Ctrl+→', desc: '单词选择' },
      { keys: 'Ctrl+Shift+A', desc: '全选' },
      { keys: 'Esc', desc: '清除选择' },
    ],
  },
  {
    title: '删除',
    entries: [
      { keys: 'Backspace / Delete', desc: '字符' },
      { keys: 'Ctrl+D / Ctrl+H', desc: '字符后/前' },
      { keys: 'Ctrl+W', desc: '单词前' },
      { keys: 'Alt+Backspace', desc: '单词前' },
      { keys: 'Alt+D', desc: '单词后' },
      { keys: 'Ctrl+K', desc: '到行尾' },
      { keys: 'Ctrl+U', desc: '到行首' },
    ],
  },
  {
    title: '复制粘贴',
    entries: [
      { keys: 'Ctrl+C', desc: '有选择 → 复制' },
      { keys: 'Ctrl+X', desc: '有选择 → 剪切' },
      { keys: 'Ctrl+V', desc: '粘贴（图片优先）' },
    ],
  },
  {
    title: '其他',
    entries: [
      { keys: 'Ctrl+L', desc: '清空输入框' },
      { keys: 'Ctrl+Shift+E', desc: '展开工具调用' },
      { keys: 'Ctrl+B', desc: '切换侧栏' },
      { keys: 'Ctrl+M', desc: '切换模型' },
      { keys: '/help', desc: '查看所有快捷键' },
      { keys: '?', desc: '查看所有快捷键' },
      { keys: 'F1', desc: '查看所有快捷键' },
      { keys: '/skill X', desc: '加载技能 X' },
      { keys: '/clear', desc: '开新会话' },
      { keys: '/compact', desc: '压缩历史' },
      { keys: '↑/↓ (空输入)', desc: '历史消息' },
    ],
  },
]
