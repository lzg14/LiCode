# `/` 菜单精简计划

**目标**：`/` 菜单**只显示 skills 和必要命令**，精简所有非必要的命令。新增 `/clear` 用于开新会话。

**日期**：2026-06-21

---

## 现状

`packages/tui/routes/home.tsx` 中 `/` 菜单触发时显示 7 个固定命令 + 动态 skill 列表：

| 命令 | 功能 |
|---|---|
| `/compact` | 压缩对话历史 |
| `/model` | 切换模型（picker）|
| `/provider` | 切换 provider（picker）|
| `/search` | 搜索历史消息 |
| `/save` | 保存会话 |
| `/load` | 加载会话 |
| `/workflow` | 旧 workflow 命令（迁到 skill）|
| `/skill <name>` | 加载技能 |

---

## 改动决策

### 菜单中保留

| 命令 | 备注 |
|---|---|
| `/skill <name>` | 动态列出所有 skill |
| `/compact` | 常用功能，保留 |
| `/clear` | **新增** — 开新会话 |

### 删掉的命令

| 命令 | 删什么 |
|---|---|
| `/model` | 菜单 + handleSubmit 都删；**保留 Ctrl+M picker**（用户换模型常用） |
| `/provider` | 菜单 + handleSubmit + picker 全删（用户反馈"没做好不好使"） |
| `/search` | 菜单 + handleSubmit 全删 |
| `/save` | 菜单 + handleSubmit 全删 |
| `/load` | 菜单 + handleSubmit 全删 |
| `/workflow` | 菜单 + handleSubmit 全删（已被 `/skill` 取代） |

### 保留的能力（非菜单入口）

- `Ctrl+B` 切侧栏
- `Ctrl+M` 切 model picker（保留 `/model` 走快捷键）
- `Ctrl+L` 清屏（如果有）
- `Ctrl+C/D` 退出

### 保留的函数（即使入口删了）

- `compactSession()` — `/compact` 还在用
- `getAvailableModels` / `switchModel` — picker 还在用
- `clearMessages()` — `/clear` 会扩展它

---

## `/clear` 设计

**语义**：开新会话（不是简单清屏）

**行为**：
1. 清空 UI 上的 messages
2. 重置 `persistentSessionId = undefined`，下次 run 自动创建新 session
3. 旧 session 数据**保留在 SQLite**（未来 `/history` 类功能可查询）

**为什么不是"清空 session DB"**：
- 用户可能想恢复刚才的对话
- SQLite 是单一可信源，UI 清空就行
- 简单可靠，没有"删错了"风险

### 实现位置

`packages/tui/context/loop.tsx`：

```ts
// 新增 LoopContext 接口方法
clearSession: () => void  // 重置成新会话

// 实现
const clearSession = () => {
  setMessages([])
  setStreamingText("")
  persistentSessionId = undefined
  setLlmCallCount(0)
  setActiveSkill(null)
  setActiveSkillInstructions(null)
  // 可选：清除 todos
  setTodos([])
}
```

---

## 步骤

- [ ] **Step 1：`/clear` 后端实现**
  - `packages/tui/context/loop.tsx`：
    - 在 LoopContext 接口（第 71 行附近）加 `clearSession: () => void`
    - 在 `clearMessages` 旁边加 `clearSession` 函数实现（如上）
    - 在 context value 对象（第 496 行附近）暴露 `clearSession`
  - **verify**：
    ```bash
    grep -n "clearSession" packages/tui/context/loop.tsx
    ```
    有 3 处匹配（interface、实现、expose）

- [ ] **Step 2：`/clear` 前端接入**
  - `packages/tui/routes/home.tsx` 的 `handleSubmit`：
    - 加 `if (text === '/clear') { clearSession(); return }` 分支
    - 位置建议放在 `/compact` 分支之后
  - **verify**：
    ```bash
    grep -n "/clear" packages/tui/routes/home.tsx
    ```
    有匹配

- [ ] **Step 3：清空 `slashItems` 列表**
  - `home.tsx` 第 196-212 行 `slashItems` 函数：
    - 删 7 个 `type: 'cmd'` 项（/compact、/model、/provider、/search、/save、/load、/workflow）
    - 加 `{ type: 'cmd', label: '/clear', desc: '开新会话（清空当前对话）' }` 和 `{ type: 'cmd', label: '/compact', desc: '压缩对话历史' }`
  - **verify**：`slashItems` 只剩 `/clear`、`/compact` 和动态 skills

- [ ] **Step 4：精简 `handleSlashSubmit`**
  - 第 224-254 行：删 `selected.label === '/xxx'` 判断，只保留：
    - `/clear` → `clearSession()`
    - `/compact` → `compactSession()`
  - skill 类型分支保留
  - **verify**：
    ```bash
    grep -n "selected.label ===" home.tsx
    ```
    只剩 `/clear` 和 `/compact`

- [ ] **Step 5：精简 `handleSubmit` 的命令处理**
  - 第 35-162 行：删 `/model`、`/provider`、`/workflow`、`/search`、`/save`、`/load` 的 6 个 if 分支
  - 保留 `/compact` 和 `/skill`，加 `/clear`
  - **verify**：
    ```bash
    grep -n "text.startsWith('/" home.tsx
    ```
    只剩 `/`、`/compact`、`/skill`、`/clear`

- [ ] **Step 6：清理未用的 imports**
  - 删除的命令会让一些 import 变孤儿：
    - `/model` 删 → `getAvailableModels` 在 picker 里还在用，**保留**
    - `/provider` 删 → `getAvailableProviders`/`switchProvider`/`providerPickerOpen`/`setProviderPickerOpen`/`providerPickerIdx` 也要删
    - `/search` 删 → 没新增 import
    - `/save` `/load` 删 → 用了动态 `import("fs/promises")`，已自包含，**保留**
    - `/workflow` 删 → 用了 `setActiveSkill`，**保留**
  - **verify**：
    ```bash
    grep -n "Provider\|providerPicker" home.tsx
    ```
    输出为空（除了 `provider` 字符串字面量如有）

- [ ] **Step 7：删 provider picker UI**
  - 第 339-371 行附近的 `Show when={providerPickerOpen()}` 整段：删
  - 全局 keyboard handler 中 provider picker 逻辑（第 280-291 行）：删
  - 关联 state：`providerPickerOpen`、`setProviderPickerOpen`、`providerPickerIdx`、`setProviderPickerIdx` 删
  - **verify**：
    ```bash
    grep -n "providerPicker" home.tsx
    ```
    输出为空

- [ ] **Step 8：更新 `/` 提示文案**
  - 第 32 行：`"输入 / 后用 ↑↓ 选择命令，或直接输入 /compact、/model 等"`
  - 改成：`"输入 / 后用 ↑↓ 选择技能/命令，或直接输入 /compact、/clear"`
  - **verify**：TUI 输入裸 `/` 看到新文案

- [ ] **Step 9：更新 README**
  - `README.md`：
    - 删 "斜杠命令菜单" 章节里的命令列表，改成：
      ```
      /skill <name>  激活技能
      /compact       压缩对话历史
      /clear         开新会话
      ```
    - 加快捷键说明：
      ```
      Ctrl+B    切换侧栏
      Ctrl+M    切换模型
      ```
  - **verify**：`grep "斜杠\|快捷键" README.md` 描述符合

- [ ] **Step 10：CHANGELOG**
  - 加 Unreleased 条目：
    ```markdown
    ### 变更
    - **`/` 菜单精简**：移除 `/model`、`/provider`、`/search`、`/save`、`/load`、`/workflow` 六个命令。`/compact` 保留。换模型改用 `Ctrl+M`。
    - **新增 `/clear`**：开新会话（清空 UI，保留 SQLite 数据）。
    ```

- [ ] **Step 11：验收**
  ```bash
  # 1. 编译通过
  bunx tsc --noEmit --skipLibCheck

  # 2. 测试
  bun test packages/tools packages/tui 2>&1 | tail -5

  # 3. 端到端（手动）
  bun run dev
  # - 输入 / 看菜单：只剩 /skill <name>, /compact, /clear
  # - 输入 /clear 测试：消息清空，新 session
  # - 输入 /compact 测试：仍然工作
  # - 输入 /model /provider：应该无效（作为普通消息）
  # - Ctrl+M：仍然能切 model picker

  # 4. 残留检查
  grep -rn "providerPicker\|toggleProviderPicker" packages/tui/
  # 期望：无输出
  ```

- [ ] **Step 12：提交**
  - 拆 2 个 commit：
    1. `refactor: 精简 / 菜单 + 新增 /clear`
    2. `docs: README + CHANGELOG 同步`
  - **verify**：`git log --oneline -3` 显示新提交

---

## 涉及文件

| 文件 | 操作 |
|---|---|
| `packages/tui/context/loop.tsx` | 加 `clearSession` 方法 + 暴露 |
| `packages/tui/routes/home.tsx` | 删 6 个命令 + 加 /clear + 删 provider picker |
| `README.md` | 更新快捷键 + 命令说明 |
| `CHANGELOG.md` | 加 Unreleased 条目 |

---

## 不做的事

| 不要做 | 原因 |
|---|---|
| 不要删 `compactSession`、`getAvailableModels`、`switchModel` 等函数 | 还在用 |
| 不要改快捷键（Ctrl+B/Ctrl+M/Ctrl+L） | 已存在且工作 |
| 不要碰 sidebar | 用户没提 |
| 不要改 session 数据库 schema | `/clear` 不动 DB |
| 不要加 `/help` 或 `/commands` | 用户明确说"暂时不要" |
| 不要加 skill 分类/分组 | 不在范围 |

---

## 验收

完成后：

1. ✅ `/` 菜单只显示 `/skill <name>`、`/compact`、`/clear`
2. ✅ `/clear` 清空 UI 且开新 session
3. ✅ `/compact` 仍工作
4. ✅ `/model`、`/provider` 等命令**无效**（作为普通消息）
5. ✅ `Ctrl+M` 仍能切 model picker
6. ✅ TypeScript 编译通过
7. ✅ 测试无新失败
8. ✅ README + CHANGELOG 同步

---

## 工作量

约 45-60 分钟：

| 步骤 | 时间 |
|---|---|
| Step 1-2（`/clear` 实现）| 15 分钟 |
| Step 3-5（命令精简）| 20 分钟 |
| Step 6-7（imports + provider picker 清理）| 10 分钟 |
| Step 8-10（提示文案 + 文档）| 10 分钟 |
| Step 11-12（验收 + 提交）| 10 分钟 |

---

## 风险

| 风险 | 缓解 |
|---|---|
| 用户后来想恢复 `/provider` | 相关函数保留在 loop.tsx，5 分钟可加回 |
| `/clear` 误清空体验差 | 系统消息提示"已开新会话"；旧数据在 SQLite 可恢复 |
| provider picker 删不干净 | Step 7 严格 grep `providerPicker` |
| model picker 误删 | Step 6 只删 `/model` 命令处理，picker 走 Ctrl+M 保留 |
| skill 列表为空时菜单体验 | 加占位提示"无 skills，参考 docs 配置" |

---

## 后续可选增强（不在本次范围）

1. `/` 菜单支持 `/skill <关键词>` 模糊过滤（已有 `slashInput` 过滤逻辑）
2. 菜单显示 skill 描述（从 SKILL.md frontmatter 读 description）
3. `/history` 列出历史会话（基于 SQLite）
4. `/resume <id>` 恢复到指定会话