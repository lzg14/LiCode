> ⚠️ **本文档已完成（2026-06-22）**
>
> Tab 把选中命令填入输入框，Enter 走 `handleSlashSubmit` 直接执行（而非当作文本发 LLM）。
>
> 完整归档说明参见：[`docs/plans/archive/README.md`](./README.md)

# Slash 菜单 Tab 行为改进 实施计划

**目标**：Tab 把选中命令**辅助填入**输入框（光标在末尾），**关掉 slash 框**，**标记命令来源**。用户按 **Enter 确认** → 走 `handleSlashSubmit` 路径**直接执行命令**，而不是把命令当普通文本发给 LLM。

**日期**：2026-06-22
**前置**：现状已摸清，根因明确

---

## 根因（用户报告的"按回车没反应"真相）

当前 `home.tsx:167-176`：

```ts
else if (evt.name === "tab") {
  evt.preventDefault()
  const selected = items[slashIdx()]
  if (!selected) return
  setPromptText(selected.label + " ")   // ← 填入文本
  setSlashOpen(false)                   // ← 关闭菜单
  // ❌ 问题：没标记"这是来自 slash 菜单的命令"
}
```

Tab 之后：
- 输入框文本变成 `/help `（末尾带空格）
- 菜单关闭
- 用户按 Enter
- 触发 opentui 的 `{name: "return", action: "submit"}` → 调用 `prompt/index.tsx:58` 的 `handleSubmit`
- `handleSubmit` 走 `props.onSubmit(text)` 把 `/help ` 当**普通文本**发给 LLM
- `/help` 命令**没被执行**（既没开 help 面板，也没清空）

这才是用户报告的"按回车没反应" — **回车发了文本给 LLM，不是没反应**。help 面板没开，clear 没清空，compress 没压缩，看起来"没反应"。

---

## 目标流程

```
输入 /         → 菜单开
↓
选择 /help     → 高亮
↓
按 Tab         → 输入框显示 '/help '，光标末尾，菜单关
                → 在 prompt 上标记 "pending slash command = '/help'"
↓
按 Enter       → 检测到 pending slash command
                → 走 handleSlashSubmit 路径（不发给 LLM）
                → 弹出帮助面板 / 清空 / 激活 skill / 触发命令
                → 清空 prompt + 清掉标记
```

---

## 完整发现的问题清单

### 🔴 高严重度

| # | 问题 | 位置 | 影响 |
|---|---|---|---|
| 1 | Tab 填入后丢失"slash 命令"语义 | `home.tsx:172` | 回车把命令当文本发给 LLM |
| 2 | prompt onSubmit 不识别 `/` 开头的命令 | `prompt/index.tsx:58-67` + `home.tsx` | 命令永远走 LLM 路径 |
| 3 | 没标记 "pending slash command" 状态 | 整体 | Tab 填入和回车确认之间没有桥梁 |

### 🟡 中严重度

| # | 问题 | 位置 | 影响 |
|---|---|---|---|
| 4 | 菜单关闭时 `onInputChange` 可能瞬时再次开菜单 | `home.tsx:90-96` | Tab 后文本仍以 `/` 开头，会重新开菜单 |
| 5 | 末尾空格导致提交后 LLM 收到 `/help ` | `home.tsx:172` | trim 不够，应该 trim 末尾空格 |

### 🟢 低严重度

- skill 项当前 Tab 后填入 `/skill-name ` 同样问题
- Enter 在菜单中**当前是直接执行**（不经过输入框），但 Tab 填入后 Enter 不再触发

---

## 步骤

### Phase 1：设计"pending slash command"机制

- [ ] **Step 1：home.tsx 加状态**
  ```ts
  // 新增：标记 Tab 填入但还没回车确认的命令
  const [pendingSlashCmd, setPendingSlashCmd] = createSignal<string | null>(null)
  ```
  - 文件：`packages/tui/routes/home.tsx`
  - **verify**：`grep "pendingSlashCmd" packages/tui/routes/home.tsx` 有匹配

- [ ] **Step 2：Tab 处理改成 setPendingSlashCmd**
  ```ts
  // home.tsx Tab 处理
  else if (evt.name === "tab") {
    evt.preventDefault()
    const selected = items[slashIdx()]
    if (!selected) return
    // trim 末尾空格，避免后面 LLM 收到 '/help '
    setPromptText(selected.label)  // ← 不再加空格
    setSlashOpen(false)
    setSlashInput("")
    setSlashIdx(0)
    setPendingSlashCmd(selected.label)  // ← 新增：标记命令
  }
  ```
  - 文件：`packages/tui/routes/home.tsx:167-176`
  - **verify**：grep "setPendingSlashCmd" 找到调用

### Phase 2：把 pendingSlashCmd 传到 prompt

- [ ] **Step 3：home.tsx 传给 prompt 组件**
  ```tsx
  <Prompt
    ...
    pendingSlashCmd={pendingSlashCmd()}
    onSlashCmdConsumed={() => setPendingSlashCmd(null)}
  />
  ```
  - 文件：`packages/tui/routes/home.tsx`（在 prompt 渲染处）
  - **verify**：grep "pendingSlashCmd" 找到 prop

- [ ] **Step 4：Prompt 接受这两个 prop**
  - `packages/tui/component/prompt/index.tsx` 接口加：
  ```ts
  pendingSlashCmd?: string | null
  onSlashCmdConsumed?: () => void
  ```
  - **verify**：grep "pendingSlashCmd" 在 prompt 里找到

### Phase 3：Prompt submit 时检测 pendingSlashCmd

- [ ] **Step 5：handleSubmit 优先走 slash 路径**
  ```ts
  // prompt/index.tsx handleSubmit
  const handleSubmit = () => {
    if (!input || input.isDestroyed) return
    const text = input.plainText.trim()
    const images = pendingImages()
    
    // 新增：如果有 pending slash 命令，走 handleSlashSubmit
    if (props.pendingSlashCmd && text === props.pendingSlashCmd && images.length === 0) {
      props.onSlashCmdConsumed?.()
      props.onSlashSubmit?.(props.pendingSlashCmd)  // 新增 prop
      input.clear()
      return
    }
    
    if (!text && images.length === 0) return
    props.onSubmit(text, images.length > 0 ? images : undefined)
    if (text) history.add(text)
    setPendingImages([])
    input.clear()
  }
  ```
  - 文件：`packages/tui/component/prompt/index.tsx:58-67`
  - **verify**：grep "onSlashSubmit" 找到调用

- [ ] **Step 6：home.tsx 传 onSlashSubmit 回调**
  ```tsx
  <Prompt
    ...
    onSlashSubmit={(cmd) => {
      // 直接调 handleSlashSubmit 路径
      setSlashIdx(0)  // 不重要，但保险
      handleSlashSubmitByLabel(cmd)
    }}
  />
  ```
  - 新增 `handleSlashSubmitByLabel(label)` 函数：跟现有 `handleSlashSubmit()` 逻辑一致，但是用传入的 label 而不是 `slashItems()[slashIdx()]`
  - 文件：`packages/tui/routes/home.tsx`
  - **verify**：grep "handleSlashSubmitByLabel" 找到定义

### Phase 4：清理 handleSlashSubmit 复用

- [ ] **Step 7：抽取 handleSlashSubmitByLabel**
  ```ts
  // home.tsx 提取复用函数
  const handleSlashSubmitByLabel = (label: string) => {
    if (label === '/clear') {
      clearSession()
    } else if (label === '/compact') {
      compactSession()
    } else if (label === '/help') {
      setHelpOpen(true)
    } else if (label.startsWith('/')) {
      // skill 命令
      const skillName = label.replace(/^\//, '')
      setActiveSkill(skillName)
      addMessage({ role: "system", content: `技能 "${skillName}" 已激活，可在侧栏查看指令` })
    }
  }
  ```
  - 旧 `handleSlashSubmit` 改成调用 `handleSlashSubmitByLabel(items[slashIdx()].label)`
  - 文件：`packages/tui/routes/home.tsx`
  - **verify**：grep "handleSlashSubmitByLabel" 找到

### Phase 5：处理 Tab 后菜单瞬间重开

- [ ] **Step 8：handleInputChange 区分 pendingSlashCmd**
  ```ts
  // home.tsx handleInputChange
  const handleInputChange = (text: string) => {
    if (props.pendingSlashCmd) {
      // pending 状态下，输入框是命令 + 任意后缀，不开菜单
      // 用户改文本就当作普通输入
      // 简单的方案：直接关掉菜单（如果开了），等用户主动输入 / 时再开
      setSlashOpen(false)
      return
    }
    if (text.startsWith('/')) {
      setSlashInput(text)
      setSlashOpen(true)
      setSlashIdx(0)
    } else {
      setSlashOpen(false)
    }
  }
  ```
  - 文件：`packages/tui/routes/home.tsx`
  - **verify**：grep "pendingSlashCmd" 在 handleInputChange 找到

### Phase 6：测试 + 文档

- [ ] **Step 9：手动验证完整流程**
  - 场景 1：输入 `/` → ↓选 `/help` → Tab → 输入框显示 `/help`（无末尾空格）+ 光标末尾 + 菜单关 → Enter → 帮助面板打开
  - 场景 2：输入 `/` → 直接 Enter → 帮助面板打开（现有行为）
  - 场景 3：输入 `/de` → Tab → 输入框 `/debug-system` → Enter → skill 激活
  - 场景 4：Tab 填入后，用户在末尾加字（如 `/help 帮我`）→ Enter → 走普通 onSubmit（不触发 slash）
  - 场景 5：Tab 填入后，用户改第一个字符（`/Help`）→ Enter → 走普通 onSubmit
  - **verify**：5 个场景都符合预期

- [ ] **Step 10：CHANGELOG 更新**
  - Unreleased：
    ```
    ### 修复
    - **Slash 菜单 Tab 后回车确认**：Tab 把命令辅助填入输入框后，按回车现在能正确执行命令（之前回车把命令当普通文本发给 LLM）。新增 pendingSlashCmd 状态标记命令来源。
    ```
  - **verify**：CHANGELOG.md 同步

- [ ] **Step 11：commit**
  - 单一 commit：`fix: slash 菜单 Tab 后回车确认执行命令`
  - **verify**：`git log --oneline -1` 显示

---

## 涉及文件

| 文件 | 操作 |
|---|---|
| `packages/tui/routes/home.tsx` | 改：加 pendingSlashCmd 状态 + 重构 handleSlashSubmit |
| `packages/tui/component/prompt/index.tsx` | 改：加 pendingSlashCmd / onSlashCmdConsumed / onSlashSubmit prop |
| `CHANGELOG.md` | 改：Unreleased 加修复条目 |

---

## 不做什么

| 项 | 原因 |
|---|---|
| 不改 Enter 在菜单里的行为 | 现有"Enter 直接执行"是合理的快捷路径 |
| 不做 fuzzy search | 当前 includes 过滤够用 |
| 不动 skill 系统 | skill 激活走 handleSlashSubmitByLabel 即可 |
| 不改末尾空格为参数占位符 | 简洁性：去掉空格让用户清楚知道这就是命令 |

---

## 验收

完成后：
1. ✅ Tab 填入后按 Enter 执行命令（不再发给 LLM）
2. ✅ Tab 后光标在末尾
3. ✅ Tab 后菜单关闭
4. ✅ 状态一致：pendingSlashCmd、slashInput、input.plainText 同步
5. ✅ 用户修改命令文本后回车 → 走普通 onSubmit
6. ✅ Skill 项 Tab 也能直接激活
7. ✅ 现有 200+ 测试无回归

---

## 风险

| 风险 | 缓解 |
|---|---|
| pendingSlashCmd 状态和实际文本不一致 | Step 8 的 `handleInputChange` 检测到 pendingSlashCmd 时把菜单关掉，等用户主动删掉 / 改成别的 |
| onSlashSubmit 调用时机问题 | 用 `text === props.pendingSlashCmd` 严格判断，避免误触发 |
| Prompt 组件 prop 增加破坏现有调用 | grep Prompt 看看所有调用方，确保新 prop 都是可选的 |
| 用户在 Tab 填入后改一个字符就 Enter | 严格判断 `text === props.pendingSlashCmd`，改了就当普通文本 |

---

## 决策点

### 决策 1：Tab 填入末尾加不加空格？

**选项 A**（推荐）：不加空格，`/help`
- 优点：干净，回车直接确认；用户加参数时自己加空格
- 缺点：跟 IDE 习惯略有不同

**选项 B**：加空格，`/help `
- 优点：暗示"可加参数"
- 缺点：回车后 LLM 收到 `/help `（多余空格）

**选 A**。理由：用户原话是"辅助输入"，回车确认。空格会让回车判断复杂化。

### 决策 2：用户改了一个字符后还能 Tab 取消吗？

**选不能**。简单点：用户改了就当普通输入，不再走 slash 路径。改回去也无效（避免循环）。

### 决策 3：菜单里按 Esc 之后状态？

Esc 现状：只关菜单，不清 pendingSlashCmd。Tab 之后按 Esc 也一样。
- 推荐：Esc 时清掉 pendingSlashCmd（菜单关了就不需要这个标记了）
- 备选：保持不变（pendingSlashCmd 不影响其他逻辑）

**选推荐**。理由：状态一致性。

---

## 工作量

| 步骤 | 时间 |
|---|---|
| Phase 1-2（状态设计 + 传 prop） | 20 分钟 |
| Phase 3-4（submit 路径 + 复用） | 30 分钟 |
| Phase 5（菜单重开保护） | 15 分钟 |
| Phase 6（验证 + 文档 + commit） | 25 分钟 |
| **合计** | **约 1.5 小时** |

---

确认后发给 agent。
