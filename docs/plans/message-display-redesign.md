# 消息显示完整设计 — 实施计划

**目标**：消除 MessageList 渲染闪烁（特别是 markdown 高亮切换时整 viewport 重绘），同时保留"新消息自动滚到底"的体验。

**日期**：2026-07-04
**状态**：待审批

---

## 1. 现状盘点

### 1.1 已完成改动（已 commit + 未 commit）

| 改动 | 文件 | 状态 |
|---|---|---|
| PendingStreamView 用 `<Show>` 替代 `<Switch>` 切分支（防销毁旧子树） | message-list.tsx | ✅ 2026-06-22 已修（commit fbc5161） |
| `pendingText` + `streamingSegments` 用 `batch()` 合并 | loop.tsx | ✅ 2026-06-22 已修（commit 979a388） |
| `processedMessages` 用 createMemo 替代闭包内 `allMsgs` 快照 | message-list.tsx | ✅ 2026-06-22 已修 |
| `MarkdownText` 函数组件 | message-list.tsx | 现有 |
| `MarkdownTextInline` 函数组件（ThinkingView 内） | thinking-view.tsx | 现有 |
| syntaxStyle 提升到 MessageList 顶层 sharedSyntaxStyle memo（防每实例重建） | message-list.tsx, thinking-view.tsx | 🆕 本次新加（未 commit） |
| ScrollBox 配置：`paddingRight: 0`、`verticalScrollbarOptions.visible: false`、`contentOptions.flexShrink: 0` | home.tsx | 🆕 本次新加（未 commit） |

### 1.2 用户报告的闪烁症状

> "最新的输出，开始不是高亮（流式闭合段，CollapsibleText 渲染），然后变成高亮（assistant 消息持久化后 ThinkingView 用 markdown 渲染）的时候，所有输出内容闪一下"

**关键事实**：
- 流式闭合段（CollapsibleText）不闪
- 持久化 assistant 消息（markdown 高亮）触发**整 viewport 闪**
- 这是**单次闪烁**，不是持续闪烁
- 每次新 assistant 回合完成时**都闪一次**

### 1.3 已尝试方案 + 结果（避免重复）

| 尝试 | 改动 | 结果 |
|---|---|---|
| 1. streamingSegments 闭合段 `streaming={true}` | message-list.tsx 第 300 行 | ❌ 无效 |
| 2. streamingSegments 闭合段改用 CollapsibleText | message-list.tsx 第 300 行 | ⚠️ 部分有效（流式段不闪，但最终消息仍然闪） |
| 3. 临时 `stickyScroll={false}` | home.tsx 第 297 行 | ✅ **用户确认不闪**，但失去自动滚动 |

**用户已验证结论**：**stickyScroll 重置 scrollTop + 整 viewport 重绘**是 markdown 高亮渲染时"整 viewport 闪一下"的真正根因。

### 1.4 根因分析（基于 opentui 源码 + 用户验证）

**opentui MarkdownRenderable 的 mount 流程**（`node_modules/@opentui/core/index.js:7987-9396`）：

```
new MarkdownRenderable(...)
  → setContent(value)       → updateBlocks()          解析 markdown AST
  → setStreaming(value)     → updateBlocks(true)      forceUpdate=true 重建所有 blocks
  → setSyntaxStyle(value)   → _styleDirty = true
  → setFg(value)            → _styleDirty = true
  → setBg(value)            → _styleDirty = true
  → setConceal(value)       → _styleDirty = true
renderSelf()
  → _styleDirty=true 触发 rerenderBlocks()           重渲染所有 blocks（含 list 的 forceUpdate=true）
```

**流式闭合段（CollapsibleText）不闪的原因**：`<text>` 组件 mount 时无 markdown 解析开销，单帧完成。

**markdown 高亮时整 viewport 闪的链路**：
1. 新 assistant 回合完成，messages 列表新增项
2. `<MessageItem>` mount，`<ThinkingView>` 渲染 markdown
3. markdown 组件 mount → 内容高度变化（比流式 CollapsibleText 高度不同）
4. scrollbox 内容高度变化 → 触发**重新布局**
5. `stickyScroll={true}` + `stickyStart="bottom"` → `applyStickyStart("bottom")` 重置 `verticalScrollBar.scrollPosition = maxScrollTop`
6. 滚动条位置变化 → **整 viewport 重新绘制**
7. 用户视觉上看到"所有输出内容闪一下"

### 1.5 当前未处理的代码改动

`packages/tui/component/message-list.tsx`：
- 第 30-50 行 `MarkdownText` 加了 `syntaxStyle?: SyntaxStyle` prop（保留兜底 createMemo）
- 第 217-225 行 MessageList 顶层 `createMemo(() => createMarkdownSyntaxStyle(...))` sharedSyntaxStyle
- 第 287 行 `<MessageItem msg={tool} syntaxStyle={sharedSyntaxStyle()} />`
- 第 293 行 `<MessageItem msg={item.msg} syntaxStyle={sharedSyntaxStyle()} />`
- 第 300 行 `<MarkdownText content={seg.text} syntaxStyle={sharedSyntaxStyle()} />`
- 第 313 行 `<PendingStreamView syntaxStyle={sharedSyntaxStyle()} />`

`packages/tui/component/thinking-view.tsx`：
- `MarkdownTextInline` 加了 `syntaxStyle?: SyntaxStyle` prop
- `ThinkingView` 加了 `syntaxStyle?: SyntaxStyle` prop 并下传

`packages/tui/routes/home.tsx`：
- ScrollBox 配置（`paddingRight: 0`、`verticalScrollbarOptions.visible: false`、`contentOptions.flexShrink: 0`）

**这些改动有效但不够**——单独 syntaxStyle 提升 + ScrollBox 配置优化**没解决闪烁**（用户验证过"修了还是闪"），需要 stickyScroll 维度的修复。

### 1.6 opentui ScrollBox 内部机制（Step 1 仪表化发现）

`node_modules/@opentui/core/renderables/ScrollBox.d.ts` 第 62 行：

```typescript
private _hasManualScroll;   // ← opentui 内部已管理"用户是否手动滚动"状态
private isAtStickyPosition;
private isAtStickyReengagePoint;
```

`node_modules/@opentui/core/index.js:10565-10585` 显示 opentui 已经实现"条件 stickyScroll"：

```javascript
if (stickyStart && !this._hasManualScroll) {
  this.applyStickyStart(stickyStart);   // 自动滚到底
} else if (stickyStart && this._hasManualScroll && this.isAtStickyReengagePoint(...)) {
  this._hasManualScroll = false;
  this.applyStickyStart(stickyStart);   // 用户回到底部时恢复
}
```

**opentui 内部行为**：
- 用户**一直在底部**（`_hasManualScroll = false`，默认状态）→ 每次内容变化都调 `applyStickyStart("bottom")`
- `applyStickyStart("bottom")` 执行 `verticalScrollBar.scrollPosition = Math.max(0, scrollHeight - viewport.height)` —— 强制重置 scrollPosition 保持 sticky
- 用户**上滚过**（`_hasManualScroll = true`）→ 不自动 sticky
- 用户**回到底部**（`isAtStickyReengagePoint`）→ 自动恢复 sticky

**真正的闪烁链路（修正）**：

1. markdown 组件 mount → 内容高度变化（markdown 比流式 CollapsibleText 高度不同）
2. scrollbox 的 `scrollHeight` 变化 → `maxScrollTop` 变化
3. 用户在底部 → `_hasManualScroll = false` → opentui 调 `applyStickyStart("bottom")`
4. `verticalScrollBar.scrollPosition = 新 maxScrollTop` → setter 触发
5. 整 viewport 重绘
6. 用户视觉上看到"所有输出内容闪一下"

**结论**：opentui 已经实现了"用户上滚后禁用 stickyScroll"，但**用户在底部时仍会因内容高度变化触发整 viewport 重绘**——这是 stickyScroll 的固有行为。

**opentui 不提供"stickyScroll 但不在内容变化时重绘"的选项**——这是 opentui 的固有限制。

---

## 2. 候选方案

### 方案 A：条件 stickyScroll（推荐）

**思路**：保留"新消息自动滚到底"的体验，但只在用户处于底部时启用 stickyScroll；用户上滚查看历史时禁用，避免每帧重置 scrollTop 引发整 viewport 重绘。

**实现**：
- 监听 `scrollbox` 的 `onScroll` 事件（opentui 是否暴露？需要验证）
- 维护 `userScrolled` signal：用户上滚超过 30px → true；用户滚回底部（距底 < 10px）→ false
- 当 `userScrolled()` 为 true 时，`stickyScroll={false}`；否则 `stickyScroll={true}`
- chunk 到达时：新内容追加在底部 → 如果 `userScrolled` 为 false（用户在底部）→ 自动滚到底；如果为 true → 用户主动保持位置

**opentui ScrollBox.d.ts 未发现 `onScroll` 事件**（grep 0 命中）。**需要先做仪表化验证 opentui 是否支持**。

### 方案 B：完全去掉 stickyScroll + 显式"跳到底"快捷键

**思路**：禁用自动滚动，新消息来了不自动滚到底；用户按 `End` 键或 `Ctrl+End` 跳到底。

**代价**：失去"新消息自动滚到底"——用户必须主动按键才能看到新消息。对 AI coding agent 来说，用户希望看着 LLM 流式输出，**这个体验损失大**。

### 方案 C：保留 stickyScroll + 接受 markdown mount 时闪烁

**思路**：回到当前 commit 状态（不带 syntaxStyle 提升、不带 ScrollBox 优化），接受 markdown mount 时的 1 帧视觉重绘。

**代价**：用户视觉体验差——"所有输出内容闪一下"持续存在。

---

## 3. 推荐方案：A（条件 stickyScroll）

### 3.1 子步骤

#### Step 1：仪表化验证 opentui ScrollBox 是否支持 onScroll 事件
- 文件：`node_modules/@opentui/core/renderables/ScrollBox.d.ts` + index.js
- 候选 API：`onScroll` 回调 / `addEventListener("scroll", ...)` / `verticalScrollBar.onChange` 之类
- verify: grep 找到支持的 API，写最小复现测试

#### Step 2：实现 `userScrolled` signal + 滚动检测
- 文件：`packages/tui/routes/home.tsx`
- 实现：监听 ScrollBox scroll 事件 → 根据 scrollTop vs maxScrollTop 判断是否在底部
  - 上滚（scrollTop < maxScrollTop - 10）→ userScrolled = true
  - 滚回底部（scrollTop >= maxScrollTop - 10）→ userScrolled = false
- verify: 单元测试或手动跑 TUI 验证：上滚后 disable stickyScroll，回到底部 enable

#### Step 3：动态 stickyScroll prop
- 文件：`packages/tui/routes/home.tsx`
- 实现：`<scrollbox stickyScroll={!userScrolled()} ... />`
- verify: 跑 TUI 触发场景——新消息来了自动滚（userScrolled=false）；用户上滚后不再自动滚；滚回底部恢复

#### Step 4：保留已优化的 syntaxStyle 顶层共享 + ScrollBox 配置
- 文件：message-list.tsx, thinking-view.tsx, home.tsx
- 这些改动独立有效（防 syntaxStyle 重建、防 paddingRight 重排），即使 stickyScroll 修了也保留
- verify: tsc + 现有测试通过

#### Step 5：回归测试
- 文件：新增 `packages/tui/component/__tests__/message-list-scrolling.test.ts`
- 测试 userScrolled signal 在滚动时的状态变化
- mock ScrollBox 的 onScroll 触发
- verify: vitest run 新测试通过

#### Step 6：commit + CHANGELOG
- 文件：CHANGELOG.md `## [Unreleased]` 加条目
- 提交信息：fix(tui): 条件 stickyScroll 消除 markdown 高亮时整 viewport 闪烁
- verify: git log 显示 commit

### 3.2 风险

| 风险 | 应对 |
|---|---|
| opentui ScrollBox 不暴露 onScroll 事件 | 备选：监听 `verticalScrollBar.scrollPosition` getter 的访问（不可行）；或定时轮询 scrollTop（hack）。如果都不行，回退到方案 B |
| 条件 stickyScroll 实现后仍有边缘场景闪烁 | 加单元测试覆盖 userScrolled 状态切换；保留 syntaxStyle 顶层共享优化 |
| 用户在底部时仍闪 | 检查是否 scrollHeight 变化触发额外 layout；必要时调 `viewportCulling: true`（已默认） |

### 3.3 验证

1. 跑 TUI：发 LLM 任务
2. 观察 markdown 高亮渲染时整 viewport 是否还闪
3. 验证新消息自动滚到底（userScrolled=false 时）
4. 验证上滚后禁用自动滚（userScrolled=true 时）
5. 验证滚回底部后恢复自动滚

---

## 4. 不做什么

- ❌ 不重构整个 streaming 模型（`pendingText` + `streamingSegments` 双信号合并成单一结构）—— 那是更大的改造
- ❌ 不动 opentui 源码
- ❌ 不动 loop 的 streamAccumulator 内部逻辑
- ❌ 不改 markdown 组件本身（markdown mount 时 1 帧视觉重绘是 opentui 固有的，靠条件 stickyScroll 避免触发整 viewport 重绘即可）
- ❌ 不引入新的全局配置项（除非用户要求）

---

## 5. 待审批

**请用户决定**：
1. 是否走方案 A（条件 stickyScroll）？
2. 如果 opentui 不支持 onScroll，是否回退到方案 B（去掉 stickyScroll + 显式快捷键跳到底）？
3. 是否接受 1 帧视觉重绘作为"可接受 trade-off"（方案 C）？

待审批后开始实施。