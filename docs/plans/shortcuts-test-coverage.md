# 快捷键测试覆盖补全计划

**目标**：把 `shortcuts.test.ts` 从"测导出"升级到"测行为"，覆盖 25+ 个快捷键的真正逻辑。

**日期**：2026-06-21
**前置**：`packages/tui/component/prompt/index.tsx` 已有完整 handler（commit 不需重做）

---

## 现状

```ts
// packages/tui/component/prompt/__tests__/shortcuts.test.ts
✓ copyToClipboard is a function
✓ readFromClipboard is a function
✓ exports Prompt component
✓ exports focusInput
✓ exports setPromptText
✓ exports prependPromptText
```

**6 个测试，0 个验证行为**。注释承认：

```ts
// 注意：完整测试需要 mock TextareaRenderable
// 这里只测试基本的类型导出
```

### 后果

- 改 opentui API → CI 不报警
- 改 handler 逻辑 → CI 不报警
- 唯一保护：手动 TUI 测（容易漏）

---

## 设计原则

1. **不 mock 整个 TextareaRenderable**（太多方法）
2. **mock 一个 minimal fake `input` 对象**，只覆盖 handler 用到的方法
3. **handler 逻辑抽出成纯函数**（当前是嵌套闭包）
4. **每个快捷键 = 1 个测试**

---

## 步骤

- [ ] **Step 1：抽出 handler 为可测函数**
  - 当前 `handleKeyDown` 是 Prompt 组件内的箭头函数，闭包捕获 `input`、`editor` 等
  - 改为导出纯函数 `createShortcutHandler(deps)`：
    ```ts
    // packages/tui/component/prompt/shortcuts.ts (新文件)

    export interface ShortcutDeps {
      input: TextareaRenderableLike
      hasSelection: () => boolean
      getSelectedText: () => string
      copyToClipboard: (text: string) => Promise<void>
      readClipboardImage: () => Promise<{ data: string; mime: string } | null>
      readFromClipboard: () => Promise<string | null>
      setPendingImages: (fn: (prev: any[]) => any[]) => void
      toggleToolCallExpanded: () => void
      isDisabled: () => boolean
      popupOpen: () => boolean
      handleSubmit: () => void
      historyUp: () => void
      historyDown: () => void
    }

    export type KeyEvent = {
      name: string
      ctrl?: boolean
      shift?: boolean
      meta?: boolean
      preventDefault: () => void
    }

    export async function handleShortcut(e: KeyEvent, deps: ShortcutDeps): Promise<boolean> {
      // 返回 true 表示已处理（已 preventDefault），false 表示让原生处理
      // ... 把现有 handleKeyDown 的逻辑搬过来
    }
    ```
  - **verify**：原文件能编译；新文件导出 `handleShortcut`

- [ ] **Step 2：Prompt 组件接新 handler**
  - `packages/tui/component/prompt/index.tsx`：
    ```ts
    import { handleShortcut } from './shortcuts'

    const handleKeyDown = (e: any) => handleShortcut(e, {
      input,
      hasSelection: () => input.hasSelection(),
      getSelectedText: () => input.getSelectedText(),
      copyToClipboard,
      readClipboardImage,
      readFromClipboard,
      setPendingImages,
      toggleToolCallExpanded,
      isDisabled: () => !!props.disabled,
      popupOpen: () => !!props.popupOpen,
      handleSubmit,
      historyUp: () => { ... },
      historyDown: () => { ... },
    })
    ```
  - **verify**：`bun test packages/tui` 仍然 6 pass

- [ ] **Step 3：写 fake input mock**
  - `shortcuts.test.ts` 增加 mock 工厂：
    ```ts
    function createFakeInput() {
      const calls: { method: string; args: any[] }[] = []
      const input: any = {}
      const methods = [
        'moveCursorLeft', 'moveCursorRight',
        'moveCursorLeft_select', 'moveCursorRight_select',
        'moveWordBackward', 'moveWordForward',
        'moveCursorUp', 'moveCursorDown',
        'gotoLineHome', 'gotoLineEnd',
        'gotoBufferHome', 'gotoBufferEnd',
        'gotoLineHome_select', 'gotoLineEnd_select',
        'moveWordBackward_select', 'moveWordForward_select',
        'selectAll', 'clearSelection',
        'deleteSelection', 'deleteWordBackward', 'deleteWordForward',
        'deleteToLineEnd', 'deleteToLineStart',
        'deleteCharBackward', 'deleteCharForward',
        'insertText', 'clear',
        'hasSelection', 'getSelectedText', 'getText', 'setText',
      ]
      for (const m of methods) {
        input[m] = (...args: any[]) => {
          calls.push({ method: m, args })
        }
      }
      input.hasSelection = () => false  // 默认无选择
      input.getSelectedText = () => ''
      input._calls = calls
      return input
    }
    ```
  - **verify**：单元测试可断言 `input._calls`

- [ ] **Step 4：覆盖所有 Ctrl 组合键测试**
  - 文件分组：
    ```ts
    describe('Ctrl shortcuts', () => {
      it('Ctrl+C with selection → copy', ...)
      it('Ctrl+C without selection → passthrough', ...)
      it('Ctrl+X with selection → cut', ...)
      it('Ctrl+X without selection → delete to EOL', ...)
      it('Ctrl+V with image → paste image', ...)
      it('Ctrl+V with text → paste text', ...)
      it('Ctrl+V empty clipboard → no-op', ...)
      it('Ctrl+Shift+A → select all', ...)
      it('Ctrl+A → goto line home', ...)
      it('Ctrl+A with selection → clear selection first', ...)
      it('Ctrl+E → goto line end', ...)
      it('Ctrl+Shift+E → toggle tool calls', ...)
      it('Ctrl+B → move cursor left', ...)
      it('Ctrl+F → move cursor right', ...)
      it('Ctrl+D → delete char forward', ...)
      it('Ctrl+D with selection → delete selection', ...)
      it('Ctrl+H → delete char backward (Backspace)', ...)
      it('Ctrl+W → delete word backward', ...)
      it('Ctrl+K → delete to line end', ...)
      it('Ctrl+U → delete to line start', ...)
      it('Ctrl+L → clear input', ...)
      it('Ctrl+Home → goto buffer home', ...)
      it('Ctrl+End → goto buffer end', ...)
    })
    ```
  - **verify**：每个 it 至少一个 `expect(input._calls).toContainEqual({...})`

- [ ] **Step 5：覆盖 Alt 组合键（meta）**
  ```ts
  describe('Alt shortcuts (meta)', () => {
    it('Alt+B → move word backward', ...)
    it('Alt+F → move word forward', ...)
    it('Alt+Backspace → delete word backward', ...)
    it('Alt+D → delete word forward', ...)
  })
  ```

- [ ] **Step 6：覆盖 Shift 选择**
  ```ts
  describe('Shift shortcuts', () => {
    it('Shift+← → move cursor left with select', ...)
    it('Shift+→ → move cursor right with select', ...)
    it('Shift+Home → goto line home with select', ...)
    it('Shift+End → goto line end with select', ...)
  })
  ```

- [ ] **Step 7：覆盖无修饰键**
  ```ts
  describe('No modifier', () => {
    it('Home → goto line home', ...)
    it('End → goto line end', ...)
    it('Tab → insert 2 spaces', ...)
    it('Esc → passthrough (popup open)', ...)
    it('Up arrow with empty input → history up', ...)
    it('Up arrow with non-empty input → passthrough', ...)
  })
  ```

- [ ] **Step 8：覆盖优先级和 fallback**
  ```ts
  describe('Priority and fallback', () => {
    it('disabled → all shortcuts ignored', ...)
    it('popup open → ESC passthrough', ...)
    it('Ctrl+C with no selection → passthrough (abort)', ...)
    it('unknown Ctrl key → passthrough', ...)
  })
  ```

- [ ] **Step 9：验证测试数量和质量**
  - 目标：50+ 测试用例
  - 每个用例：1 个 expect，断言具体方法被调用
  - **verify**：`bun test packages/tui/component/prompt/__tests__/shortcuts.test.ts` 报告 "50 tests, 0 fail"

- [ ] **Step 10：CI 准备**
  - 加 `.github/workflows/test.yml`（如果没有）
  - 跑 `bun test packages/tui` 自动验证
  - **verify**：CI 通过

- [ ] **Step 11：CHANGELOG**
  - Unreleased 条目：
    ```markdown
    ### 测试
    - **快捷键测试覆盖**：从 6 个导出检查升级到 50+ 行为测试，覆盖 Ctrl/Alt/Shift/无修饰键全部分支
    - **抽出 handleShortcut 纯函数**：handler 逻辑从 Prompt 组件剥离，便于测试和维护
    ```

- [ ] **Step 12：提交**
  - 拆 2 个 commit：
    1. `refactor: 抽出 handleShortcut 纯函数 + 50 个测试覆盖`
    2. `docs: CHANGELOG 同步`
  - **verify**：`git log --oneline -3` 显示新提交

---

## 涉及文件

| 文件 | 操作 |
|---|---|
| `packages/tui/component/prompt/shortcuts.ts` | 新建（handleShortcut 纯函数） |
| `packages/tui/component/prompt/index.tsx` | 改用新 handler |
| `packages/tui/component/prompt/__tests__/shortcuts.test.ts` | 重写（50+ 测试） |
| `CHANGELOG.md` | 加 Unreleased 条目 |
| `.github/workflows/test.yml` | 新建（如果需要） |

---

## 不做什么

| 项 | 原因 |
|---|---|
| 不集成 vitest + jsdom | 当前 bun test 够用 |
| 不测 opentui 内部 | 我们测自己写的 handler 逻辑 |
| 不重构现有 6 个测试 | 直接扩展 |
| 不动 handler 行为 | 只测现状，确保行为不变 |

---

## 验收

完成后：

1. ✅ `bun test packages/tui/component/prompt/__tests__/shortcuts.test.ts` 50+ tests pass
2. ✅ 每个测试断言 `input._calls` 包含预期方法调用
3. ✅ Prompt 组件行为不变（手动 TUI 验证一次）
4. ✅ tsc 编译通过
5. ✅ CHANGELOG 同步

---

## 工作量

| 步骤 | 时间 |
|---|---|
| Step 1-2（抽出 handler） | 1 小时 |
| Step 3（fake input） | 30 分钟 |
| Step 4-8（写测试） | 2-3 小时 |
| Step 9-10（验证 + CI） | 30 分钟 |
| Step 11-12（文档 + commit） | 30 分钟 |
| **合计** | **约 4-5 小时** |

---

## 风险

| 风险 | 缓解 |
|---|---|
| 抽出 handler 后行为改变 | Step 2 跑现有测试 + 手动 TUI 验证 |
| fake mock 漏了某个方法 | 从 handler 里 grep 所有 input.xxx() 调用，确保全 mock |
| 测试维护成本高（handler 改 1 个就要改 1 个测试） | 这正是测试的价值 —— 行为改变必被发现 |
| vitest 类型与 bun 不兼容 | 当前已用 vitest（package.json），无需切换 |

---

## 决策点

### 决策 1：测试框架

**当前**：项目用 vitest（package.json: `"test": "vitest"`）

vitest 有 describe/it/expect 全套，**继续用 vitest**。

### 决策 2：handleShortcut 文件位置

**选项 A**：`packages/tui/component/prompt/shortcuts.ts`（同目录）

**选项 B**：`packages/tui/component/prompt/__tests__/shortcuts.ts`（测试目录）

**推荐 A**。handler 是生产代码，不是测试代码，应该可以单独 import。

### 决策 3：handleShortcut API

**选项 A**：返回 `boolean`（true=已处理，false=未处理）

**选项 B**：返回 `void`，全部 preventDefault

**推荐 A**。保留 escape hatch，让某些键（如 Ctrl+C 无选择）能让原生处理（用于 abort）。

---

**确认后发给 agent 跑。** 跑完让我 review。