> ⚠️ **本文档已完成（2026-06-21）**
>
> 输入框完整快捷键（光标移动、选择、剪贴板、删除等），对标 VS Code / readline / Claude Code TUI。
>
> 完整归档说明参见：[`docs/plans/archive/README.md`](./README.md)

# Prompt 输入框快捷键计划

**目标**：在 `packages/tui/component/prompt/index.tsx` 增加完整的输入框编辑快捷键（光标移动、选择、剪切/复制/粘贴、删除等），对齐主流编辑器（VS Code、readline、Claude Code TUI）。

**日期**：2026-06-21

---

## 现状

`packages/tui/component/prompt/index.tsx` 的 `handleKeyDown` 现有处理：

| 键 | 行为 |
|---|---|
| `ESC` | popupOpen 时让出；否则 abort / 清队列 |
| `Ctrl+V` | 粘贴剪贴板图片 |
| `Up/Down` | 输入为空时翻历史；否则默认 |
| `Ctrl+L` | preventDefault 但无动作 |
| `Ctrl+E` | 切换工具调用展开 |

opentui `TextareaRenderable` 已原生支持：
- 字符输入 / Backspace / Delete
- 箭头键移动光标
- 但**无选择、无单词跳转、无剪切/复制粘贴**（这些要走我们的 handler）

`EditorView` API（opentui 提供）：
- `setSelection(start, end)` / `getSelection()` / `getSelectedText()` / `deleteSelectedText()`
- `setCursorByOffset(offset)`
- `getNextWordBoundary()` / `getPrevWordBoundary()`
- `getEOL()` / `getVisualSOL()` / `getVisualEOL()`
- `moveUpVisual()` / `moveDownVisual()`

---

## 设计原则

1. **对齐主流**：参考 VS Code / Claude Code / readline 习惯
2. **不破坏现有**：现有 Ctrl+E（工具调用展开）、Ctrl+V（图片粘贴）等保留
3. **冲突时优先级**：选择 > 单词 > 字符
4. **有选择时优先**：所有动作都先检查 selection，有则对 selection 操作

---

## 完整快捷键表

### 光标移动

| 快捷键 | 行为 | API |
|---|---|---|
| `←` / `→` | 光标左/右移 1 字符（带选择：Shift+→） | 字符移动 |
| `Home` / `End` | 移到行首/行尾 | `getVisualSOL()` / `getEOL()` |
| `Ctrl+A` | 移到行首（readline 习惯） | 同 Home |
| `Ctrl+E` | **冲突**：当前是工具调用切换 → 改用 `Ctrl+Shift+E` 到行尾 | `getEOL()` |
| `Ctrl+B` / `Ctrl+F` | 后退/前进 1 字符（readline） | 字符移动 |
| `Ctrl+←` / `Ctrl+→` | 按单词跳转 | `getPrevWordBoundary()` / `getNextWordBoundary()` |
| `Alt+B` / `Alt+F` | 同上（readline 习惯） | 同上 |
| `Ctrl+Home` / `Ctrl+End` | 移到文本开头/结尾 | `setCursorByOffset(0/length)` |

### 选择

| 快捷键 | 行为 |
|---|---|
| `Shift+←` / `Shift+→` | 选择 1 字符 |
| `Shift+Home` / `Shift+End` | 选择到行首/尾 |
| `Shift+Ctrl+←` / `Shift+Ctrl+→` | 按单词选择 |
| `Ctrl+Shift+A` | 全选（避免和 Ctrl+A 冲突） |
| `Esc`（有选择时） | 清除选择，光标不动 |

### 删除 / 剪切

| 快捷键 | 行为 |
|---|---|
| `Backspace` | 删除光标前 1 字符（原生支持） |
| `Delete` | 删除光标后 1 字符（原生支持） |
| `Ctrl+D` | 删除光标后 1 字符（readline，等价于 Delete） |
| `Ctrl+H` | 等价 Backspace（readline） |
| `Ctrl+W` | 删除前一个单词 |
| `Alt+Backspace` | 删除前一个单词（同 Ctrl+W） |
| `Alt+D` | 删除后一个单词 |
| `Ctrl+K` | 删除到行尾（kill to EOL） |
| `Ctrl+U` | 删除到行首（kill to SOL） |
| `Ctrl+X` | 剪切（无选择时：清空整行） |

### 复制 / 粘贴

| 快捷键 | 行为 |
|---|---|
| `Ctrl+C` | 有选择：复制到剪贴板；无选择：保留现有 abort 逻辑 |
| `Ctrl+V` | 有剪贴板图片：粘贴图片；否则：粘贴文本（**已有逻辑扩展**） |

### 其他

| 快捷键 | 行为 |
|---|---|
| `Ctrl+L` | 清空输入框（preventDefault 已有，无动作 → 改成清空） |
| `Tab` | 在菜单中：补全菜单项（已有）；不在菜单中：插入 2 个空格 |

---

## 不在范围

- 多光标（multi-cursor）
- 矩形选择
- Vim 模式（hjkl）
- Mac/Windows 修饰键差异（统一用 Ctrl，Mac 用户自己改系统设置）
- 自动补全（snippet 展开等）

---

## 步骤

- [ ] **Step 1：抽取 helper 函数**
  - `packages/tui/component/prompt/index.tsx` 新增：
    ```ts
    function getSelection(): { start: number; end: number } | null
    function setSelection(start: number, end: number): void
    function clearSelection(): void
    function getCursorOffset(): number
    function setCursorOffset(offset: number): void
    function moveCursorBy(delta: number, extendSelection?: boolean): void
    function moveCursorToOffset(offset: number, extendSelection?: boolean): void
    function moveCursorWordLeft(extendSelection?: boolean): void
    function moveCursorWordRight(extendSelection?: boolean): void
    function getSelectedText(): string
    function deleteSelection(): void
    function insertTextAtCursor(text: string): void
    ```
  - **verify**：`grep "function get\|function set\|function move" prompt/index.tsx` 有匹配

- [ ] **Step 2：扩展 handleKeyDown**
  - 在 `handleKeyDown` 里新增 case（保持现有 ESC、Ctrl+V 图片、Up/Down 历史、Ctrl+L、Ctrl+E 逻辑）
  - 按"选择 > 单词 > 字符"优先级处理
  - 处理 Shift 修饰键：`e.shift`
  - 处理 Ctrl 修饰键：`e.ctrl`
  - 处理 Alt 修饰键：`e.meta`（opentui 把 Alt 映射到 meta）
  - **verify**：
    ```bash
    grep -E "case |switch|if.*name === " packages/tui/component/prompt/index.tsx
    ```
    看到多个 case

- [ ] **Step 3：实现光标移动**
  - `←` `→`：字符移动
  - `Home` `End`：行首/行尾
  - `Ctrl+A` `Ctrl+Shift+E`：行首/行尾（readline 习惯）
  - `Ctrl+B` `Ctrl+F`：字符移动
  - `Ctrl+←` `Ctrl+→` `Alt+B` `Alt+F`：单词跳转
  - `Ctrl+Home` `Ctrl+End`：文本开头/结尾
  - 带 Shift：扩展选择
  - **verify**：手动测，每键移动光标正确

- [ ] **Step 4：实现选择**
  - `Shift+←` `Shift+→` `Shift+Home` `Shift+End`
  - `Shift+Ctrl+←` `Shift+Ctrl+→`
  - `Ctrl+Shift+A`：全选
  - `Esc`（有选择时）：清选择
  - **verify**：手动测，能选中、视觉有反白

- [ ] **Step 5：实现删除/剪切**
  - `Ctrl+D` `Ctrl+H` `Ctrl+W` `Alt+Backspace` `Alt+D`
  - `Ctrl+K` `Ctrl+U`
  - `Ctrl+X`（有选择剪切；无选择清空）
  - **verify**：手动测各种删除场景

- [ ] **Step 6：扩展 Ctrl+C / Ctrl+V**
  - `Ctrl+C`：有选择 → 复制到系统剪贴板（用 Bun.write 或 node:os）；无选择 → 保留 abort
  - `Ctrl+V`：现有图片逻辑保留；图片为空时粘贴文本（用 readText from clipboard）
  - **verify**：
    - 选中文本 Ctrl+C → 系统剪贴板有内容
    - 系统剪贴板有文本时 Ctrl+V → 输入框插入
    - 系统剪贴板有图片时 Ctrl+V → 显示图片

- [ ] **Step 7：清空输入框**
  - `Ctrl+L`：改成清空输入框（光标移到开头）
  - **verify**：输入几个字按 Ctrl+L → 输入框清空

- [ ] **Step 8：剪贴板实现**
  - Bun 提供 `Bun.write` / `Bun.read` 不支持剪贴板
  - 方案 A：用 Node `navigator.clipboard`（仅 web 环境，不可用）
  - 方案 B：用 system 命令（Windows: `clip`，Mac: `pbcopy`，Linux: `xclip`）
  - 方案 C：用 opentui 自己的 clipboard API（如果有）
  - 默认实现：`packages/tui/util/clipboard.ts` 跨平台封装
  - **verify**：在 Win/Mac/Linux 上 Ctrl+C 能复制

- [ ] **Step 9：测试**
  - 新增 `packages/tui/component/prompt/__tests__/shortcuts.test.ts`
  - 用 mock TextareaRenderable（jsdom 或手写 stub）
  - 测试每个快捷键的行为
  - **verify**：`bun test packages/tui` 全过

- [ ] **Step 10：更新 README**
  - 文档加一节"快捷键"列出所有支持的键
  - **verify**：`grep "快捷键\|shortcuts" README.md` 有匹配

- [ ] **Step 11：CHANGELOG**
  - 加 Unreleased 条目：
    ```markdown
    ### 新增
    - **输入框快捷键**：完整的光标移动（`←/→/Home/End/Ctrl+A/Ctrl+B/Ctrl+E/Ctrl+←`）、选择（`Shift+方向键`/`Ctrl+Shift+A`）、删除（`Ctrl+D/H/W/K/U/X`）、复制粘贴（`Ctrl+C/V`）、清空（`Ctrl+L`）。对齐 VS Code / readline 习惯。
    ```

---

## 涉及文件

| 文件 | 操作 |
|---|---|
| `packages/tui/component/prompt/index.tsx` | 主改动（+helper +handler） |
| `packages/tui/util/clipboard.ts` | 新建（跨平台剪贴板） |
| `packages/tui/component/prompt/__tests__/shortcuts.test.ts` | 新建测试 |
| `README.md` | 更新快捷键章节 |
| `CHANGELOG.md` | 加 Unreleased 条目 |

---

## 关键技术点

### 1. opentui key 事件结构

```ts
// KeyEvent 类似 { name: 'left', ctrl: false, shift: false, meta: false, ... }
e.name  // 'a' | 'left' | 'right' | 'home' | 'end' | 'backspace' | 'delete' | 'tab' | ...
e.ctrl
e.shift
e.meta   // 注意：opentui 把 Alt 映射到 meta
```

### 2. Selection 操作

```ts
// 设置选择
input.editor.setSelection(start, end, { bg: '#444' }, { fg: '#fff' })
// 获取选择
const sel = input.editor.getSelection()  // { start, end }
// 删除选择
input.editor.deleteSelectedText()
// 获取选中文本
input.editor.getSelectedText()
```

### 3. Word boundary

```ts
// 获取光标到下一个 word boundary 的 visual cursor
const nextWord = input.editor.getNextWordBoundary()
const prevWord = input.editor.getPrevWordBoundary()
// nextWord.x 是 row，nextWord.y 是 col（注意顺序！）
```

### 4. 跨平台剪贴板

```ts
// packages/tui/util/clipboard.ts
import { spawn } from 'child_process'

export async function copyToClipboard(text: string): Promise<void> {
  const cmd = process.platform === 'win32' ? 'clip'
            : process.platform === 'darwin' ? 'pbcopy'
            : 'xclip -selection clipboard'
  const proc = spawn(cmd, { shell: true, stdio: 'pipe' })
  proc.stdin.write(text)
  proc.stdin.end()
  await new Promise(resolve => proc.on('exit', resolve))
}

export async function readFromClipboard(): Promise<string> {
  const cmd = process.platform === 'win32' ? 'powershell -command Get-Clipboard'
            : process.platform === 'darwin' ? 'pbpaste'
            : 'xclip -selection clipboard -o'
  // ...
}
```

### 5. 冲突优先级

```
if (selection exists && key in {Ctrl+C, Ctrl+X, Delete, Backspace}) {
  // 操作 selection
} else if (key has shift) {
  // 扩展选择
} else if (key has ctrl/alt) {
  // 单词操作
} else {
  // 字符操作
}
```

---

## 验收

完成后：

1. ✅ 所有列出的快捷键在 TUI 中可用
2. ✅ 选择有视觉反馈（反白）
3. ✅ Ctrl+C 复制到系统剪贴板
4. ✅ Ctrl+V 粘贴文本/图片都能用
5. ✅ 单测覆盖每个快捷键
6. ✅ tsc 编译通过
7. ✅ README + CHANGELOG 同步

---

## 工作量

| 步骤 | 时间 |
|---|---|
| Step 1（helper） | 30 分钟 |
| Step 2-7（handler + 各种键） | 2-3 小时 |
| Step 8（剪贴板） | 30 分钟 |
| Step 9（测试） | 1-2 小时 |
| Step 10-11（文档） | 20 分钟 |
| **合计** | **约 4-6 小时** |

---

## 风险

| 风险 | 缓解 |
|---|---|
| opentui key 事件结构和我理解的不一样 | Step 1 先验证（写最小例子跑通）|
| Selection API 在不同 opentui 版本签名不同 | 在 Step 1 先跑 `bun run -e '...'` 验证 |
| 跨平台剪贴板实现复杂 | Step 8 先实现 Windows（用户当前平台），其他平台后续 |
| 现有 Ctrl+E（工具调用切换）和 Ctrl+A/E（行首尾）冲突 | 明确文档 + Step 10 README 说明 |
| 测试 mock TextareaRenderable 复杂 | 直接测 helper 函数，不测 opentui 集成 |