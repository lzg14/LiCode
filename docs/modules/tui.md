# TUI 模块总览

> 基于 `packages/tui/` 的模块组成与职责文档
> 日期：2026-07-22

---

## 1. 一句话定位

TUI 是 licode 的终端用户界面，基于 SolidJS + opentui 构建，提供消息列表、输入框、侧栏、状态栏等交互组件。

---

## 2. 启动链

```
packages/cli/index.ts
    ↓ 调用
packages/tui/index.ts (export render/App)
    ↓
packages/tui/app.tsx (App 根组件)
    ├── ThemeProvider (主题上下文)
    ├── LoopProvider (核心循环 + 消息状态)
    ├── ShortcutProvider (快捷键)
    └── RouteProvider (路由)
    ↓
packages/tui/routes/home.tsx (主路由)
    ├── MessageList (消息列表)
    ├── Prompt (输入框)
    ├── Sidebar (侧栏)
    └── StatusBar (状态栏)
```

---

## 3. 模块结构

### 3.1 Context（状态管理）

| 文件 | 职责 | 关键导出 |
|------|------|----------|
| `loop.tsx` | 核心循环：消息状态、LLM 调用、工具执行、streaming | `LoopProvider`, `useLoop()` |
| `theme.tsx` | 主题色管理（primary, text, error 等） | `ThemeProvider`, `useTheme()` |
| `keybind.tsx` | 全局快捷键注册与处理 | `KeybindProvider`, `useKeybind()` |
| `config.tsx` | 配置加载（licode.config.json） | `ConfigProvider`, `useConfig()` |
| `history.tsx` | 输入历史（上下翻页） | `HistoryProvider`, `useHistory()` |
| `route.tsx` | 路由状态 | `RouteProvider`, `useRoute()` |
| `shortcuts.ts` | 快捷键状态（model picker 等） | `sidebarVisible`, `modelPickerOpen` |
| `todos.ts` | Todo 列表状态 | `useTodos()` |

### 3.2 Component（UI 组件）

| 文件 | 职责 |
|------|------|
| `message-list.tsx` | 消息列表：渲染 user/assistant/tool 消息，streaming 内容 |
| `prompt/` | 输入框：快捷键、斜杠菜单、图片粘贴 |
| `sidebar.tsx` | 侧栏：session 信息、token 统计、skill 状态 |
| `status-bar.tsx` | 状态栏：工具数、模型名、耗时 |
| `thinking-view.tsx` | thinking 内容渲染（灰色文本） |
| `help-panel.tsx` | 帮助面板（F1 触发） |
| `logo.tsx` | 启动 Logo |
| `spinner.tsx` | 加载动画 |
| `border.tsx` | 边框组件 |
| `collapsible-text.tsx` | 可折叠文本 |

### 3.3 Routes（路由）

| 文件 | 职责 |
|------|------|
| `home.tsx` | 主路由：整合所有组件，处理斜杠菜单、model picker |

### 3.4 Util（工具函数）

| 文件 | 职责 | 依赖 |
|------|------|------|
| `stream-accumulator.ts` | 流式内容分块状态机 | 纯函数 |
| `thinking-display.ts` | thinking 标签解析 | 纯函数 |
| `help-content.ts` | 帮助面板数据 | 纯函数 |
| `clipboard.ts` | 跨平台剪贴板 | 系统命令 |
| `syntax-style.ts` | Markdown 语法高亮样式 | 纯函数 |
| `selection.ts` | 文本选择工具 | 纯函数 |

### 3.5 Theme（主题）

| 文件 | 职责 |
|------|------|
| `theme.tsx` | 主题色定义（dark/light） |

### 3.6 UI（基础 UI）

| 文件 | 职责 |
|------|------|
| `toast.tsx` | Toast 通知 |

---

## 4. 核心数据流

```
用户输入 (Prompt)
    ↓
LoopProvider.run()
    ↓
CoreLoop.executePhase()
    ↓
LLM 调用 (streamText)
    ↓
onStreamText (delta) → streamAccumulator → streamingSegments + pendingText
    ↓
MessageList 渲染
    ├── messages (已完成消息)
    ├── streamingSegments (已闭合段)
    └── pendingText (未闭合段)
```

---

## 5. 外部依赖 API

### opentui

| API | 用途 | 使用位置 |
|-----|------|----------|
| `<scrollbox>` | 可滚动容器 | home.tsx |
| `<markdown>` | Markdown 渲染 | message-list.tsx |
| `<textarea>` | 输入框 | prompt/index.tsx |
| `<For>` / `<Show>` / `<Switch>` | 条件渲染 | 全局 |
| `useKeyboard` | 全局快捷键 | home.tsx |
| `stickyScroll` | 自动滚动到底部 | home.tsx |

### solid-js

| API | 用途 | 使用频次 |
|-----|------|----------|
| `createSignal` | 响应式状态 | 高（~20+） |
| `createMemo` | 计算属性 | 高（~15+） |
| `createEffect` | 副作用 | 中（~10） |
| `batch` | 批量更新 | 低（~3） |
| `For` / `Show` | 列表/条件渲染 | 高（~20+） |

---

## 6. 已知性能改造点

详见 [tui-render-optimization.md](../plans/tui-render-optimization.md)

---

## 7. 相关文档

- [tui-render-optimization.md](../plans/tui-render-optimization.md) — 性能改造计划
- [20260617-tui-review.md](../archive/20260617-tui-review.md) — TUI 现状 review（2026-06-17 旧版）
- [streaming-chunked-display.md](../plans/streaming-chunked-display.md) — 流式输出改造
