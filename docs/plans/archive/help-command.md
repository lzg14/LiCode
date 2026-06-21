# `/help` 命令计划

**目标**：在 TUI 中通过 `/help`（或 `?` / `F1`）查看所有快捷键，按类别组织，可滚动。

**日期**：2026-06-21
**优先级**：P1（25 个快捷键没人记得住）

---

## 为什么先做 `/help`

| 现状 | 之后 |
|---|---|
| 25 个快捷键没人记得 | 输入 `/help` 立即看到全表 |
| 改动快捷键没人知道 | README + TUI 同步更新 |
| 用户只能从代码里挖 | UI 一目了然 |

测试覆盖可以稍后做（plan 已写好，等 `/help` 完成再做）。

---

## 设计

### 触发方式（多入口）

| 入口 | 行为 |
|---|---|
| 输入 `/help` Enter | 打开帮助面板 |
| 输入 `?` 单独 | 打开帮助面板 |
| 按 `F1` | 打开帮助面板 |
| 在菜单里 `/` 看到 `/help` | 选中按 Enter |

### 面板 UX

```
┌─ 帮助 (↑↓ 滚动, Esc 关闭) ─────────────┐
│                                         │
│  ## 光标移动                            │
│    ← / →            字符左/右           │
│    Home / End       行首/行尾           │
│    Ctrl+A / Ctrl+E  行首/行尾           │
│    Ctrl+B / Ctrl+F  字符后/前           │
│    Ctrl+← / Ctrl+→  单词跳转           │
│    Alt+B / Alt+F    单词跳转            │
│    Ctrl+Home/End    文本开头/结尾       │
│                                         │
│  ## 选择                                │
│    Shift+←/→      字符选择            │
│    Shift+Home/End 选到行首/尾           │
│    Shift+Ctrl+←/→ 单词选择            │
│    Ctrl+Shift+A    全选                 │
│    Esc             清除选择             │
│                                         │
│  ## 删除                                │
│    Backspace/Delete 字符               │
│    Ctrl+D/H        字符后/前            │
│    Ctrl+W          单词前               │
│    Alt+Backspace   单词前               │
│    Alt+D           单词后               │
│    Ctrl+K          到行尾               │
│    Ctrl+U          到行首               │
│                                         │
│  ## 复制粘贴                            │
│    Ctrl+C    有选择 → 复制              │
│    Ctrl+X    有选择 → 剪切              │
│    Ctrl+V    粘贴（图片优先）           │
│                                         │
│  ## 其他                                │
│    Ctrl+L      清空输入框               │
│    Ctrl+Shift+E 展开工具调用            │
│    Ctrl+B      切换侧栏                 │
│    Ctrl+M      切换模型                 │
│    Ctrl+C/D    退出                     │
│    /skill X    加载技能 X              │
│    /clear      开新会话                 │
│    /compact    压缩历史                 │
│    ↑/↓ (空输入)  历史消息             │
│                                         │
└─────────────────────────────────────────┘
```

---

## 步骤

- [ ] **Step 1：定义帮助数据结构**
  - 新建 `packages/tui/util/help-content.ts`：
    ```ts
    export interface HelpEntry {
      keys: string         // "←/→" 或 "Ctrl+Shift+A"
      desc: string         // "字符左/右"
    }
    
    export interface HelpSection {
      title: string
      entries: HelpEntry[]
    }
    
    export const HELP_CONTENT: HelpSection[] = [
      { title: '光标移动', entries: [
        { keys: '← / →',           desc: '字符左/右' },
        { keys: 'Home / End',      desc: '行首/行尾' },
        { keys: 'Ctrl+A / Ctrl+E', desc: '行首/行尾' },
        // ...
      ]},
      // ...
    ]
    ```
  - **verify**：文件存在，导出 `HELP_CONTENT`

- [ ] **Step 2：新建 `HelpPanel` 组件**
  - 新建 `packages/tui/component/help-panel.tsx`：
    ```tsx
    import { Show } from 'solid-js'
    import { For } from 'solid-js'
    import { BoxRenderable, TextRenderable } from '@opentui/core'
    import { HELP_CONTENT } from '../util/help-content'
    import { useTheme } from '../context/theme'
    
    export function HelpPanel(props: { onClose: () => void }) {
      const { primary, text, textMuted, backgroundPanel } = useTheme()
      return (
        <box
          flexDirection="column"
          position="absolute"
          top={0} left={0}
          width="100%" height="100%"
          zIndex={5000}
          alignItems="center"
          justifyContent="center"
        >
          <box
            flexDirection="column"
            width={70}
            maxHeight="80%"
            paddingX={2} paddingY={1}
            backgroundColor={backgroundPanel()}
            border={['top','bottom','left','right']}
            borderColor={primary()}
          >
            <text fg={primary()}>帮助 (↑↓ 滚动, Esc 关闭)</text>
            <box height={1} />
            <scrollbox flexGrow={1} scrollY>
              <For each={HELP_CONTENT}>
                {(section) => (
                  <box flexDirection="column" marginBottom={1}>
                    <text fg={primary()}>## {section.title}</text>
                    <For each={section.entries}>
                      {(entry) => (
                        <box flexDirection="row" paddingLeft={2}>
                          <text fg={text()}>{entry.keys.padEnd(20)}</text>
                          <text fg={textMuted()}>{entry.desc}</text>
                        </box>
                      )}
                    </For>
                  </box>
                )}
              </For>
            </scrollbox>
            <box height={1} />
            <text fg={textMuted()}>按 Esc 关闭</text>
          </box>
        </box>
      )
    }
    ```
  - **verify**：组件能渲染（手动 TUI）

- [ ] **Step 3：加 `helpOpen` state 到 home.tsx**
  - `packages/tui/routes/home.tsx`：
    ```ts
    const [helpOpen, setHelpOpen] = createSignal(false)
    ```

- [ ] **Step 4：`/help` 命令处理**
  - `home.tsx` 的 `handleSubmit`：
    ```ts
    if (text === '/help' || text === '?') {
      setHelpOpen(true)
      return
    }
    ```

- [ ] **Step 5：`F1` 全局快捷键**
  - `home.tsx` 的 `useKeyboard`：
    ```ts
    if (evt.name === 'f1') {
      evt.preventDefault()
      setHelpOpen(prev => !prev)
      return
    }
    ```

- [ ] **Step 6：`Esc` 关闭 + 上下滚动**
  - `home.tsx` 的 `useKeyboard`：
    ```ts
    if (helpOpen()) {
      if (evt.name === 'escape' || evt.name === 'f1') {
        evt.preventDefault()
        setHelpOpen(false)
        return
      }
      // 上下/PageUp/PageDown/End/Home 让 scrollbox 处理
      return
    }
    ```

- [ ] **Step 7：在菜单里加 `/help`**
  - `home.tsx` 的 `slashItems`：
    ```ts
    { type: 'cmd', label: '/help', desc: '查看所有快捷键' },
    ```

- [ ] **Step 8：渲染 `<HelpPanel />`**
  - `home.tsx` 的 JSX：
    ```tsx
    <Show when={helpOpen()}>
      <HelpPanel onClose={() => setHelpOpen(false)} />
    </Show>
    ```
  - 加到 `app.tsx` 之外或 home.tsx 顶层

- [ ] **Step 9：测试**
  - `packages/tui/util/__tests__/help-content.test.ts`：
    - `HELP_CONTENT` 是非空数组
    - 每个 section 有 title 和 entries
    - keys 字段不重复（粗略检查）
  - **verify**：`bun test packages/tui` 全过

- [ ] **Step 10：README 同步**
  - README 加"快捷键"章节（直接从 `HELP_CONTENT` 生成）
  - **verify**：README 含所有键

- [ ] **Step 11：CHANGELOG**
  - Unreleased 条目：
    ```markdown
    ### 新增
    - **`/help` 命令**：输入 `/help`、`?` 或按 `F1` 查看所有快捷键（光标/选择/删除/复制粘贴等）
    ```

- [ ] **Step 12：提交**
  - 2 个 commit：
    1. `feat: /help 命令 + 帮助面板组件`
    2. `docs: README 快捷键章节 + CHANGELOG`
  - **verify**：`git log --oneline -3` 显示新提交

---

## 涉及文件

| 文件 | 操作 |
|---|---|
| `packages/tui/util/help-content.ts` | 新建（数据） |
| `packages/tui/component/help-panel.tsx` | 新建（组件） |
| `packages/tui/util/__tests__/help-content.test.ts` | 新建（测试） |
| `packages/tui/routes/home.tsx` | 改：加 helpOpen state + 触发 + 渲染 |
| `README.md` | 加快捷键章节 |
| `CHANGELOG.md` | 加 Unreleased 条目 |

---

## 不做什么

| 项 | 原因 |
|---|---|
| 不做搜索/筛选 | 25 个键全显示就够 |
| 不做主题/颜色配置 | 跟当前主题一致即可 |
| 不做键位自定义 | 用户没要求 |
| 不替代 README | README 还要有，UI 是发现入口 |

---

## 验收

完成后：

1. ✅ 输入 `/help` 弹出帮助面板
2. ✅ 输入 `?` 弹出
3. ✅ 按 F1 切换
4. ✅ Esc 关闭
5. ✅ 滚动流畅（↑↓ 翻屏）
6. ✅ 25+ 快捷键全列出，按类别分组
7. ✅ TUI 测试通过
8. ✅ README 同步

---

## 工作量

| 步骤 | 时间 |
|---|---|
| Step 1（数据） | 20 分钟 |
| Step 2（组件） | 30 分钟 |
| Step 3-8（接入） | 30 分钟 |
| Step 9-11（测试 + 文档） | 30 分钟 |
| Step 12（提交） | 5 分钟 |
| **合计** | **约 2 小时** |

---

## 风险

| 风险 | 缓解 |
|---|---|
| 弹窗挡住现有 picker 冲突 | zIndex 5000 同 model picker |
| `?` 在某些终端有特殊含义 | 仅当输入框为空时触发 |
| F1 在不同终端行为不一致 | 三种入口（`/help`/`?`/F1），互为 fallback |
| 滚动条太丑 | 接受现状，等用户反馈 |

---

## 决策点

### 决策 1：内容来源

**选项 A**：硬编码在 `help-content.ts`（上面方案）

**选项 B**：从 `prompt/shortcuts.ts` 自动生成（单一源）

**推荐 A**：当前 handler 逻辑分散（很多 if/else），抽"快捷键元数据"需要重构。硬编码更简单，文案可以精心打磨。

### 决策 2：要不要 README 章节？

**推荐要**。Help 面板是发现入口，README 是文档入口。

---

确认后发给 agent 跑，跑完 review。