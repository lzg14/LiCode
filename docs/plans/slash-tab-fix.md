# Slash 菜单 Tab 行为改进 实施计划

**目标**：让 Tab 键把选中命令**填入输入框**、**光标在末尾**、**关闭菜单**、**确保输入框拿到焦点**让用户能按回车确认。如果按 Enter，**直接执行命令**而不是当作普通文本提交。

**日期**：2026-06-22
**前置**：现状已摸清（`home.tsx:163-180` + `prompt/index.tsx:362-372`）

---

## 现状问题

用户报告："输入 `/`，选一项，按 Tab — 应该把命令输入到输入框，光标在最后，slash 框消失。然后我按回车确认。**但现在按回车没反应**。"

代码现状（`home.tsx:167-176`）：

```ts
else if (evt.name === "tab") {
  evt.preventDefault()
  const selected = items[slashIdx()]
  if (!selected) return
  setPromptText(selected.label + " ")   // 填入 /help
  setSlashOpen(false)                   // 关闭菜单
  setSlashInput("")
  setSlashIdx(0)
}
```

`setPromptText`（`prompt/index.tsx:41-46`）：

```ts
setTextFn = (text: string) => {
  if (!input || input.isDestroyed) return
  input.setText(text)
  input.cursorOffset = text.length
  input.focus()
}
```

**预期**：填入 + 光标末尾 + 关闭菜单 + 输入框焦点。理论上都对。

**实际可能的原因**：

1. **`setSlashOpen(false)` 与 `input.focus()` 时序竞争**：菜单关闭触发 `Show` 销毁，可能 input 引用已经失效
2. **`preventDefault` 没阻止 opentui 自己的 keyBindings 机制**：opentui 的 `{name: "tab"}` 内置可能走别的路径，但 Tab 通常不是内置键
3. **`onContentChange` 没被触发**：`input.setText()` 不会触发 onContentChange（opentui 内部只对用户输入触发），导致 `slashInput` 状态不一致
4. **光标位置被 `popupOpen` 变化重置**：`popupOpen` 变 false 后 prompt 重渲染可能重置 cursorOffset

---

## 完整发现的问题清单

### 🔴 高严重度

| # | 问题 | 位置 | 影响 |
|---|---|---|---|
| 1 | Tab 填入后光标可能没在末尾 | `home.tsx:172` + `prompt/index.tsx:44` | 用户看不到视觉确认 |
| 2 | Tab 后焦点可能回到默认元素 | `prompt/index.tsx:45` 的 `input.focus()` 时机 | Enter 不被 prompt 接收 |
| 3 | `setSlashOpen(false)` 后状态可能不一致 | `home.tsx:173-175` | `slashInput` 清空但 `input.plainText` 仍以 `/` 开头 → 菜单可能瞬间又被打开 |

### 🟡 中严重度

| # | 问题 | 位置 | 影响 |
|---|---|---|---|
| 4 | Enter 在菜单里是"直接执行"（不走输入框） | `home.tsx:177` + `handleSlashSubmit` | 与 Tab 行为不一致 |
| 5 | Tab 填入的是 `label + " "`（如 `/help `） | `home.tsx:172` | 用户如果想直接执行还得删空格 |
| 6 | handleSlashSubmit 不更新 prompt 文本 | `home.tsx:99-122` | 命令执行后输入框没清干净 |

### 🟢 低严重度

- skill 项的 Tab 行为没特殊处理：现在会填入 `/skill-name ` 让用户补参数
- cmd 项（/clear、/compact）的 Tab 行为合理：填入让用户能看清再决定

---

## 步骤

### Phase 1：诊断 + 验证假设

- [ ] **Step 1：加临时 log 确认 Tab 流程**
  - 在 `home.tsx:167` 加 `devLogger.debug('SLASH', 'tab pressed, selected:', selected.label)`
  - 在 `setTextFn` 里加 log 确认执行
  - 在 `setSlashOpen(false)` 后加 log 确认 `input.isDestroyed` 状态
  - **verify**：手动跑 dev 模式，看日志

- [ ] **Step 2：判断假设 1-3 哪个是真的**
  - 测试：Tab 后立刻看 `input.cursorOffset` 是多少
  - 测试：Tab 后立刻 `input.focus()` 后立刻看 `document.activeElement` 是什么
  - **verify**：定位根因

### Phase 2：修 Tab 行为（按用户期望）

- [ ] **Step 3：调整 setTextFn 时序**
  - 改用 `setTimeout(() => { ... }, 0)` 让 slashOpen=false 先完成渲染，再 focus
  - 或者：把 `input.focus()` 移到 home.tsx Tab 处理里，调完 setSlashOpen 后立刻 focus
  - **verify**：Tab 后光标在末尾，输入框有焦点

- [ ] **Step 4：Tab 后确保状态一致**
  - 调用 `props.onInputChange?.(text)` 显式同步 slashInput 状态
  - `setSlashInput(text)` 也对应
  - **verify**：Tab 后输入框保持打开状态，用户可继续输入

- [ ] **Step 5：测试 Enter 触发 submit**
  - 手动测试：Tab → Enter → 命令应该被触发
  - 如果是 `/help` 之类：可能要走 `handleSlashSubmit` 路径（直接执行）
  - 如果是 `/skill foo` 之类：直接执行 skill 激活
  - **verify**：Tab → Enter → 命令执行

### Phase 3：统一 Enter 和 Tab 的语义

- [ ] **Step 6：决策 Enter 的行为**
  - 选项 A：**Enter 直接执行命令**（保留现有行为，但要把 setSlashOpen 后焦点给回 prompt）
  - 选项 B：**Enter 也走"填入输入框"路径**，让用户有机会加参数
  - 推荐 A，因为 Tab 已经给了"填入"路径，Enter 给"直接执行"是合理的快捷操作
  - **verify**：用户选哪个

- [ ] **Step 7：调整 Enter 处理**
  - 如果选 A：Enter 走 `handleSlashSubmit()` 路径（已存在）
  - `handleSlashSubmit` 后焦点回到 prompt（但要等动画结束）
  - **verify**：Enter 直接执行命令

### Phase 4：边界情况

- [ ] **Step 8：skill 命令的 Tab 行为**
  - 比如 `/debug-system`，Tab 后输入框有 `/debug-system `
  - 用户可能想加参数（如果有），也可能想直接激活
  - 当前 skill 没有参数，Tab 填入后用户必须删空格再 Enter — 不友好
  - 解决：skill 项 Tab 时**直接执行 handleSlashSubmit**，而不是填入
  - cmd 项保持填入行为（用户可能要加额外上下文）
  - **verify**：skill 走直接执行，cmd 走填入

- [ ] **Step 9：Tab 在菜单关闭时的行为**
  - 菜单未开时，Tab 走 prompt 的"插入 2 空格"路径（`prompt/index.tsx:362-367`）— 保留
  - **verify**：菜单关时 Tab 仍然插空格

### Phase 5：测试 + 文档

- [ ] **Step 10：手动验证完整流程**
  - 场景 1：输入 `/` → ↓选 `/help` → Tab → 输入框有 `/help ` + 光标末尾 + 菜单关 + Enter 触发
  - 场景 2：输入 `/` → 直接 Enter → 触发第一条命令
  - 场景 3：输入 `/de` → 只剩匹配的 → Tab → 填入 → 继续输入
  - 场景 4：输入 `/` → Esc → 菜单关，文本还在
  - **verify**：4 个场景都符合预期

- [ ] **Step 11：CHANGELOG 更新**
  - Unreleased：
    ```
    ### 修复
    - **Slash 菜单 Tab 行为**：Tab 把选中命令填入输入框后，光标在末尾、菜单关闭、输入框拿到焦点，用户能直接按 Enter 确认。修复之前焦点丢失导致 Enter 无响应的问题。
    ```
  - **verify**：CHANGELOG.md 同步

- [ ] **Step 12：commit**
  - 单一 commit：`fix: slash 菜单 Tab 行为 — 填入后光标在末尾 + 焦点正确`
  - **verify**：`git log --oneline -1` 显示

---

## 涉及文件

| 文件 | 操作 |
|---|---|
| `packages/tui/routes/home.tsx` | 改：Tab 处理 + 状态同步 |
| `packages/tui/component/prompt/index.tsx` | 改（可能）：`setTextFn` 调整 focus 时机 |
| `CHANGELOG.md` | 改：Unreleased 加修复条目 |

---

## 不做什么

| 项 | 原因 |
|---|---|
| 不重构 slash 菜单的键盘处理 | 当前结构清晰，只是时序问题 |
| 不改 Enter 行为（按选项 A） | Tab 给"填入"、Enter 给"直接执行"是合理的快捷分层 |
| 不做 fuzzy search | 当前是 includes 过滤，够用 |
| 不动 skill 系统 | skill Tab 行为单独处理，不改系统 |

---

## 验收

完成后：
1. ✅ Tab 填入后光标**确定**在末尾（不只是设置 cursorOffset，还要验证 opentui 渲染时没重置）
2. ✅ Tab 后输入框**有焦点**（能接收 Enter）
3. ✅ Tab 后 Enter 触发 submit
4. ✅ 状态一致：slashInput、slashOpen、input.plainText 三者同步
5. ✅ Skill 项 Tab 直接执行
6. ✅ 现有 200+ 测试无回归

---

## 风险

| 风险 | 缓解 |
|---|---|
| `setSlashOpen(false)` 是异步的，setText 在它之前还是之后跑会不确定 | 把 setText 移到 setSlashOpen 之后，或用 setTimeout(0) |
| `popupOpen` 变化触发 prompt 重渲染，cursorOffset 被重置 | 在 `createEffect` 里 watch `popupOpen`，变 false 后再设置 cursorOffset |
| Tab 在不同 opentui 版本下行为不一致 | 退路：Tab 改用 `enter` 或 `space`（但用户期望是 Tab） |
| 焦点丢失导致 Enter 触发其他全局快捷键 | 显式 focus + ensureFocus 在 setSlashOpen 之后调一次 |

---

## 决策点

### 决策 1：Tab 后 Enter 行为？

**选项 A**（推荐）：Enter 直接执行命令（与现状一致）
- 优点：快捷，Tab/Enter 各自有明确分工
- 缺点：与"Tab 填入"的语义略显冲突

**选项 B**：Enter 也填入，等用户手动回车（再回一次）
- 优点：完全一致
- 缺点：多一次按键

**选 A**。理由：用户原话是"按回车确认"，A 直接满足。

### 决策 2：skill 项 Tab 行为？

**选项 A**（推荐）：skill 项 Tab 直接激活（不需要参数）
**选项 B**：skill 项 Tab 也填入（保留扩展能力）

**选 A**。当前 skill 不带参数，直接激活更符合用户预期。

### 决策 3：是否做 `/de` → Tab 后的自动补全？

**选不做**。当前 slashItems() 已经按 slashInput 过滤，用户已经能看到匹配项，Tab 选中的就是过滤后的第一项（slashIdx 默认 0）。如果用户想选非第一项，用 ↓ 调再 Tab。

---

## 工作量

| 步骤 | 时间 |
|---|---|
| Phase 1（诊断） | 15 分钟 |
| Phase 2（修 Tab） | 30 分钟 |
| Phase 3（统一语义） | 15 分钟 |
| Phase 4（边界） | 15 分钟 |
| Phase 5（验证 + 文档 + commit） | 20 分钟 |
| **合计** | **约 1.5 小时** |

---

确认后发给 agent。
