> ⚠️ **本文档已完成（2026-06-22）**
>
> 修复 MessageList 流式添加时滚动卡顿 + thinking 切换闪烁。
>
> 完整归档说明参见：[`docs/plans/archive/README.md`](./README.md)

# 计划：消除 MessageList 滚动顿挫 + Thinking 切换视觉跳变

## 背景

用户反馈在流式输出时有两个症状：
1. **视觉跳变**：thinking 已经显示出来后，突然"高亮→变灰→消失"——是 `<Switch>` 切到 `has-rest` 分支时旧灰色块被销毁、新灰色块重建
2. **滚动顿挫**：在消息流式追加时滚动"不丝滑"，有明显的顿挫感

## 已确认事实

### A. streaming 状态被拆成两个独立信号
**文件**：`packages/tui/context/loop.tsx`

```ts
const [streamingSegments, setStreamingSegments] = createSignal<Segment[]>([])
const [pendingText, setPendingText] = createSignal("")

onStreamText: (delta) => {
  const { closed, pending } = streamAccumulator.push(delta)
  if (closed.length > 0) setStreamingSegments(prev => [...prev, ...closed])
  if (pending !== pendingText()) setPendingText(pending)
}
```

每 chunk 触发**两个**信号更新 → Solid 触发**两次** microtask 重渲染（实际上当前 chunk 的 pending 在下一帧才能进入 segments，所以存在"延迟一拍"的视觉）。

### B. `PendingStreamView` 用 `<Switch>` 切分支
**文件**：`packages/tui/component/message-list.tsx`

```tsx
<Switch>
  <Match when={d().kind === "thinking-only"}>
    <box marginBottom={1} paddingLeft={1}>
      <text fg={textMuted()}>{d().text}</text>
    </box>
  </Match>
  <Match when={d().kind === "has-rest"}>
    <box flexDirection="column">
      <Show when={d().thinking}>
        <box marginBottom={1} paddingLeft={1}>
          <text fg={textMuted()}>{d().thinking}</text>
        </box>
      </Show>
      <MarkdownText content={d().rest} streaming={true} />
    </box>
  </Match>
  ...
</Switch>
```

`<Switch>` 切换会**销毁**旧子树、**挂载**新子树 → 视觉上"高亮→变灰→消失"：
- 切到 `has-rest` 时旧 `<text fg={textMuted()}>` 块被销毁
- 新灰色 thinking 块以**新 DOM 节点**方式出现
- markdown 子树首次挂载

### C. `MessageList` row 闭包用 `allMsgs` 快照
**文件**：`packages/tui/component/message-list.tsx`

```tsx
{(msg, idx) => {
  const allMsgs = messages()  // ← 一次性求值，普通 array 引用
  ...
  const isLastInBatch = idx() + 1 >= allMsgs.length
    || allMsgs[idx() + 1].role !== "tool"
    || allMsgs[idx() + 1].toolBatch !== batchId
}}
```

- `allMsgs` 求值后是普通 array，新消息插入时**不会响应式追踪**
- 注释说意图是"避免整棵 markdown 树重新挂载造成的顿顿视觉跳动"
- **副作用**：batch 判断用过期数据；新消息插入后旧 row 不会重新计算 batch 边界

### D. `ScrollBox` 配置
**文件**：`packages/tui/routes/home.tsx`

```tsx
<scrollbox
  flexGrow={1}
  scrollY={true}
  viewportOptions={{ paddingRight: 1 }}
  verticalScrollbarOptions={{ visible: true, paddingLeft: 1 }}
  stickyScroll={true}
  stickyStart="bottom"
>
```

- 显式开了**滚动条**（opentui 默认 false），且 `paddingLeft: 1` + 滚动条宽度 1 = 占 2 列
- 未传 `scrollAcceleration`（用默认）
- 未传 `viewportCulling`（opentui 默认 true）
- `stickyScroll` 每帧都 `applyStickyStart`，streaming 时频繁重置

### E. opentui Markdown 已有 streaming 优化
**文件**：`node_modules/@opentui/core/dist/index.d.ts`

```ts
streaming?: boolean  // "The trailing markdown block stays unstable"
getStableBlockCount()  // 已 stable 的 block 不重渲染
```

- 每 chunk 仍需 parse 整个 trailing unclosed block
- 配合 syntaxStyle memo 重建时，可能触发整页重排

### F. 滚动加速度库
**文件**：`node_modules/@opentui/core/dist/lib/scroll-acceleration.d.ts`

- `MacOSScrollAccel`（macOS 风格） + `LinearScrollAccel`（线性）
- 这是**滚轮输入加速度**（让连续滚轮事件衰减更自然），不是 tween 平滑滚动动画

### G. `MarkdownText` 内部 `createMemo` syntaxStyle
**文件**：`packages/tui/component/markdown-text.tsx`

```ts
const syntaxStyle = createMemo(() => createMarkdownSyntaxStyle(theme))
```

每个 `MarkdownText` 实例都创建独立 memo，每 chunk 触发 memo 重算或新创建（如果 key 变化）。

## 改动方案

### 改动 1：消除 `PendingStreamView` 的 Switch 切分支跳变（P0）
**文件**：`packages/tui/component/message-list.tsx`
**原因**：消除"高亮→变灰→消失"的视觉跳变。

**改法**：去掉 `<Switch>`/`<Match>`，改为单一子树 + 条件 `<Show>`：

```tsx
function PendingStreamView(props: { segments: Segment[] }) {
  const display = createMemo(() => deriveThinkingDisplay(props.segments, false))
  return (
    <box flexDirection="column">
      <Show when={display().thinking}>
        <box marginBottom={1} paddingLeft={1}>
          <text fg={textMuted()}>{display().thinking}</text>
        </box>
      </Show>
      <Show when={display().rest}>
        <MarkdownText content={display().rest} streaming={true} />
      </Show>
    </box>
  )
}
```

- `thinking-only` → `has-rest` 切换时**不销毁** thinking 块，只追加 markdown 子树
- 用户视觉上看到"灰色 thinking 持续显示 + 后面长出高亮正文"——**无跳变**

### 改动 2：合并 `pendingText` / `streamingSegments` 状态更新（P0）
**文件**：`packages/tui/context/loop.tsx`
**原因**：每 chunk 两次 microtask 渲染 → 合并为一次。

**改法**：用 Solid 的 `batch()`：

```ts
import { batch } from "solid-js"

onStreamText: (delta) => {
  const { closed, pending } = streamAccumulator.push(delta)
  batch(() => {
    if (closed.length > 0) setStreamingSegments(prev => [...prev, ...closed])
    if (pending !== pendingText()) setPendingText(pending)
  })
}
```

- 同一 microtask 内更新两个信号 → Solid 只触发一次依赖收集后的重渲染
- 配合改动 1 后，pendingText 变化时 markdown 增量 parse + stickyScroll 重置都只在同一帧发生

### 改动 3：修 `MessageList` row 闭包的 `allMsgs` 快照 bug（P0）
**文件**：`packages/tui/component/message-list.tsx`
**原因**：batch 判断用过期数据，新消息插入后 tool 分组错位。

**改法**：把 `const allMsgs = messages()` 改为响应式求值：

```tsx
{(msg, idx) => {
  const prevMsg = createMemo(() => {
    const all = messages()
    return idx() > 0 ? all[idx() - 1] : null
  })
  const nextMsg = createMemo(() => {
    const all = messages()
    return idx() + 1 < all.length ? all[idx() + 1] : null
  })
  ...
  const isFirstInBatch = createMemo(() => {
    const prev = prevMsg()
    return !prev || prev.role !== "tool" || prev.toolBatch !== batchId
  })
  const isLastInBatch = createMemo(() => {
    const next = nextMsg()
    return !next || next.role !== "tool" || next.toolBatch !== batchId
  })
}}
```

- 新消息插入时，旧 row 的 batch 边界判断会**自动更新**
- **保留作者"避免整棵重建"的意图**：用 `<Show when={isFirstInBatch()}>` 控制 box 渲染，Solid 的 Show 是惰性条件渲染（不创建/不挂载），已经挂载的 box 不会销毁
- `getKey` 给每个 row 稳定 key，让 Solid 的 `<For>` 不做位置错位

### 改动 4：`ScrollBox` 配置调优（P0）
**文件**：`packages/tui/routes/home.tsx`
**原因**：滚动条 visible 占 2 列 + stickyScroll 每帧重置 → 滚动顿挫。

**改法**：

```tsx
<scrollbox
  flexGrow={1}
  scrollY={true}
  stickyScroll={true}
  stickyStart="bottom"
  scrollAcceleration={new MacOSScrollAccel()}
  viewportCulling={true}
  viewportOptions={{ paddingRight: 0 }}
  verticalScrollbarOptions={{ visible: false }}
  contentOptions={{ flexShrink: 0 }}
>
```

- 滚动条显式 hidden（省 2 列）
- `paddingRight: 0` 防止 stickyScroll 抖动时让 padding 区域重排
- `scrollAcceleration: MacOSScrollAccel` → 鼠标滚轮带惯性
- `contentOptions.flexShrink: 0` → 内容容器不被 flex 压缩

### 改动 5：`syntaxStyle` 提升到 `MessageList` 顶层（P1）
**文件**：`packages/tui/component/markdown-text.tsx` + `message-list.tsx`
**原因**：每个 `MarkdownText` 实例 `createMemo` syntaxStyle → 多次创建。

**改法**：
1. `MarkdownText` 接受新 prop `syntaxStyle?: SyntaxStyle`
2. `MessageList` 顶层 `const syntaxStyle = createMemo(() => createMarkdownSyntaxStyle(theme()))`
3. 通过 props 传入每个 `MarkdownText`

如果改动后 `MarkdownText` 自身仍要兜底（无外部传入时），保留 `createMemo` 但 memo 缓存命中后无开销。

### 改动 6：减少 `stickyScroll` 频率（P2）
**文件**：`packages/tui/routes/home.tsx`
**原因**：`stickyScroll` 每帧重置 scrollTop，streaming 时视觉上抖。

**改法**：
- 用本地 signal `const [userScrolled, setUserScrolled] = createSignal(false)`
- 监听 `onScroll` 事件：上滚超过 30px → `setUserScrolled(true)`
- chunk 到达时：如果 `userScrolled()` 为 true → 临时 `<scrollbox stickyScroll={false}>`
- 用户滚回底部（接近底 10px）→ `setUserScrolled(false)` → 恢复 sticky
- 落地前需先验证 opentui 是否暴露 `isAtStickyReengagePoint` 之类的 API

## 验证

1. 流式输出一长段带 thinking 的回复，观察：
   - 不再有"高亮→变灰→消失"
   - thinking 持续显示，正文逐步追加在下方
2. 鼠标滚轮上下滚动时是否丝滑（带加速度感）
3. 滚动条不再 visible，消息区不被压缩
4. 工具消息批量插入时，batch 边界（首/末/中）的颜色和分隔线正确显示
5. 长对话（>50 条）来回滚动时帧率稳定（viewportCulling 是否真的只渲染可见行）

## 影响范围

- `packages/tui/component/message-list.tsx`（主战场）
- `packages/tui/context/loop.tsx`（状态合并）
- `packages/tui/routes/home.tsx`（ScrollBox 配置）
- `packages/tui/component/markdown-text.tsx`（可选：props 化 syntaxStyle）

## 不做

- 不重构整个 streaming 模型（`pendingText` + `streamingSegments` 双信号合并成单一结构）—— 那是更大的改造，可能影响 segment accumulator 的状态机
- 不动 opentui 源码
- 不动 loop 的 segment accumulator
