# TUI 内存泄漏 + 消息列表闪烁修复计划

**目标**：修复 LoopProvider 零 onCleanup 导致的内存泄漏，以及消息列表高频重渲染导致的闪烁
**日期**：2026-07-31

## 前置

- 已有 `tui-render-optimization.md`（未实施）覆盖了 StreamStore 长期方案，本计划聚焦**可立即落地的最小修复**
- 本计划完成后，StreamStore 方案仍可作为后续优化方向

---

## 步骤

### Step 1：LoopProvider 添加 onCleanup — 清理所有资源

**文件**：`packages/tui/context/loop.tsx`

在 `LoopProvider` 函数体内添加 `onCleanup`，清理以下资源：

1. **SIGINT 处理器**：恢复原始处理器，移除自定义处理器
2. **`toolStartTimes` Map**：清空 `toolStartTimes.clear()`
3. **`subagentStatuses`**：`setSubagentStatuses([])`
4. **`inputQueue`**：`inputQueue.length = 0`
5. **`streamAccumulator`**：`streamAccumulator.reset()`
6. **`_pendingFlushTimer`**：`clearTimeout(_pendingFlushTimer)`
7. **`abortController`**：`abortController?.abort()`

```ts
onCleanup(() => {
  // 恢复原始 SIGINT 处理器
  process.removeAllListeners('SIGINT')
  for (const handler of originalSigint) {
    process.on('SIGINT', handler as any)
  }
  // 清理所有状态
  toolStartTimes.clear()
  setSubagentStatuses([])
  inputQueue.length = 0
  streamAccumulator.reset()
  if (_pendingFlushTimer) {
    clearTimeout(_pendingFlushTimer)
    _pendingFlushTimer = null
  }
  abortController?.abort()
  abortController = null
})
```

- verify: `bunx tsc --noEmit --skipLibCheck` 编译通过；`bun test packages/tui` 全部通过

---

### Step 2：toolStartTimes 用后即删

**文件**：`packages/tui/context/loop.tsx`

在 `onToolResult` 回调中，读取 `toolStartTimes` 后立即 `delete`：

```ts
onToolResult: (result: any) => {
  setMessages((prev) => {
    const last = prev[prev.length - 1]
    if (last?.role === "tool") {
      const start = toolStartTimes.get(last.id) ?? 0
      const duration = start > 0 ? Date.now() - start : 0
      toolStartTimes.delete(last.id)  // ← 新增：用后即删
      const diff = result?.diff
      return [...prev.slice(0, -1), { ...last, toolStatus: "completed", duration, diff }]
    }
    return prev
  })
},
```

- verify: `bunx tsc --noEmit --skipLibCheck` 编译通过；手动运行一次工具调用，确认 duration 仍正常显示

---

### Step 3：subagentStatuses 回合结束后清理

**文件**：`packages/tui/context/loop.tsx`

在 `run()` 的 `finally` 块中添加 `setSubagentStatuses([])`：

```ts
finally {
  // ... 现有清理代码 ...
  setSubagentStatuses([])  // ← 新增：回合结束清理
}
```

- verify: `bunx tsc --noEmit --skipLibCheck` 编译通过；`bun test packages/tui` 通过

---

### Step 4：streamingSegments 添加防抖

**文件**：`packages/tui/context/loop.tsx`

当前 `pendingText` 有 60ms 防抖，但 `streamingSegments` 没有。对 `streamingSegments` 添加同样的防抖机制：

1. 新增 `_latestClosedSegments: Segment[]` 缓存最近一批 closed segments
2. 新增 `_segmentFlushTimer` 定时器
3. 在 `onStreamText` 中，closed segments 先存入 `_latestClosedSegments`，通过 `_scheduleSegmentFlush` 延迟合并
4. 与 pendingText 共用同一个 flush timer（避免两次 RAF），或者独立 60ms timer

```ts
let _latestClosedSegments: Segment[] = []
let _segmentFlushTimer: ReturnType<typeof setTimeout> | null = null

const _flushSegments = () => {
  _segmentFlushTimer = null
  if (_latestClosedSegments.length > 0) {
    setStreamingSegments(prev => [...prev, ..._latestClosedSegments])
    _latestClosedSegments = []
  }
}

const _scheduleSegmentFlush = () => {
  if (_segmentFlushTimer) return
  _segmentFlushTimer = setTimeout(_flushSegments, PENDING_FLUSH_MS)
}

// onStreamText 内：
onStreamText: (delta: string) => {
  const { closed, pending, mode } = streamAccumulator.push(delta)
  setStreamMode(mode)
  if (closed.length > 0) {
    _latestClosedSegments.push(...closed)
    _scheduleSegmentFlush()
  }
  _latestPending = pending
  _schedulePendingFlush()
},
```

注意：`setStreamMode` 保留在 batch 外（mode 变化是低频的，不需要防抖）。closed segments 的合并延迟到 flush 时一次性 `setStreamingSegments`。

- verify: `bunx tsc --noEmit --skipLibCheck` 编译通过；手动测试流式输出，确认 thinking/text 段正常显示，无遗漏

---

### Step 5：processedMessages 添加稳定 key

**文件**：`packages/tui/component/message-list.tsx`

当前 `<For each={processedMessages()}>` 没有 stable key，SolidJS 用数组索引做 reconciliation。修改 `processedMessages` 的返回结构，让 `type: 'msg'` 的 item 带 `msg.id`：

```tsx
// processedMessages 返回结构
type ProcessedItem =
  | { type: 'msg'; msg: Message; key: string }      // ← 新增 key
  | { type: 'tool-batch'; batchId: number; count: number; tools: Message[]; key: string }

// 在 memo 中：
result.push({ type: 'msg', msg, key: msg.id })

// tool-batch 的 key：
result.push({ type: 'tool-batch', batchId, count: batchTools.length, tools: batchTools, key: `batch_${batchId}` })
```

然后 `<For>` 使用 key：

```tsx
<For each={processedMessages()}>
  {(item) => {
    // item.key 用于 SolidJS reconciliation
    // ...
  }}
</For>
```

**注意**：SolidJS `<For>` 的 keyed reconciliation 依赖 item 的**引用稳定性**，不是显式 key 属性。要让 `<For>` 正确工作，需要确保 `processedMessages` 返回的 item 对象在消息不变时引用也稳定。最简单的方式是改用 `<For each={messages()}>` + 在渲染层做 tool-batch 折叠，而非在 memo 层做。

**备选方案**（更简单）：不修改 `processedMessages`，而是在 `<For>` 外层用 `messages()` 做 each，item 直接是 `Message`，SolidJS 自然用引用做 keyed diff。tool-batch 折叠逻辑移到 `MessageItem` 内部判断。

- verify: `bunx tsc --noEmit --skipLibCheck` 编译通过；手动测试消息列表，确认新增/更新消息时不会导致整组重渲染

---

### Step 6：onIntermediateText 平滑过渡

**文件**：`packages/tui/context/loop.tsx`

当前 `onIntermediateText`（line 515-521）在多轮工具调用时，先清空所有 streaming 状态再 addMessage，导致视觉闪烁（流式内容突然消失，然后整条消息出现）。

修改为：不清空 streaming 状态，而是直接把 `mergedText` 的内容作为新消息的内容，然后让 `PendingStreamView` 自然消失（`pendingText` 和 `streamingSegments` 都为空时 `Show when` 不满足）：

```ts
onIntermediateText: (text: string) => {
  // 先 flush 所有 pending 内容，确保用户看到的内容完整
  if (_pendingFlushTimer) {
    clearTimeout(_pendingFlushTimer)
    _pendingFlushTimer = null
  }
  if (_segmentFlushTimer) {
    clearTimeout(_segmentFlushTimer)
    _segmentFlushTimer = null
  }
  // 立即 flush，确保 pendingText 和 streamingSegments 是最新值
  setPendingText(_latestPending)
  if (_latestClosedSegments.length > 0) {
    setStreamingSegments(prev => [...prev, ..._latestClosedSegments])
    _latestClosedSegments = []
  }

  // 重置 streaming 状态（不再清空，而是让 PendingStreamView 自然消失）
  streamAccumulator.reset()
  setStreamingSegments([])
  setPendingText("")
  // 添加完整消息
  addMessage({ role: "assistant", content: text })
},
```

**关键**：`setStreamingSegments([])` + `setPendingText("")` 会让 `PendingStreamView` 的 `Show when` 条件不满足，组件自然消失。同时 `addMessage` 添加完整消息，`<For>` 追加新 item。两者在同一个 `batch()` 中完成，避免中间状态。

需要用 `batch()` 包裹整个操作：

```ts
onIntermediateText: (text: string) => {
  batch(() => {
    // flush pending
    if (_pendingFlushTimer) {
      clearTimeout(_pendingFlushTimer)
      _pendingFlushTimer = null
    }
    if (_segmentFlushTimer) {
      clearTimeout(_segmentFlushTimer)
      _segmentFlushTimer = null
    }
    setPendingText("")
    streamAccumulator.reset()
    setStreamingSegments([])
    // 添加完整消息
    addMessage({ role: "assistant", content: text })
  })
},
```

- verify: `bunx tsc --noEmit --skipLibCheck` 编译通过；手动测试多轮工具调用，确认中间轮文本不会闪烁

---

### Step 7：prompt/index.tsx 模块级变量改为组件内 ref

**文件**：`packages/tui/component/prompt/index.tsx`

当前 `focusFn`/`setTextFn`/`prependTextFn` 是模块级变量，捕获 `input` DOM 元素引用，阻止旧组件被 GC。

修改为：把模块级变量移到组件内，通过 `onCleanup` 清理：

```ts
// 删除模块级变量
// let focusFn: (() => void) | null = null
// let setTextFn: ((text: string) => void) | null = null
// let prependTextFn: ((text: string) => void) | null = null

// 改为在组件内创建
export function Prompt(props) {
  let input: TextareaRenderable
  let focusFn: (() => void) | null = null
  let setTextFn: ((text: string) => void) | null = null
  let prependTextFn: ((text: string) => void) | null = null

  // ... 现有逻辑 ...

  onCleanup(() => {
    focusFn = null
    setTextFn = null
    prependTextFn = null
  })
}
```

**注意**：需要检查 `focusFn`/`setTextFn`/`prependTextFn` 是否被其他组件通过某种方式调用（如 `useLoop().focusInput`）。如果是，需要改用 context 传递，而非模块级变量。

- verify: `bunx tsc --noEmit --skipLibCheck` 编译通过；手动测试输入框聚焦、文本设置功能正常

---

### Step 8：onCleanup 中清理 segment flush timer

**文件**：`packages/tui/context/loop.tsx`

在 Step 1 的 `onCleanup` 中和 Step 4 的 `_segmentFlushTimer` 需要一并清理。在 `onCleanup` 和 `run()` 的 `finally` 块中都要清理：

```ts
// finally 块中
if (_segmentFlushTimer) {
  clearTimeout(_segmentFlushTimer)
  _segmentFlushTimer = null
}
```

- verify: `bunx tsc --noEmit --skipLibCheck` 编译通过；`bun test packages/tui` 通过

---

## 不做什么

| ❌ | 原因 |
|---|---|
| 引入 StreamStore | 是长期正确方向，但本计划聚焦最小修复，与 `tui-render-optimization.md` 不冲突 |
| 视口虚拟化 | 仅长会话 >200 条有意义，优先级低 |
| 修改 `<markdown>` 组件 | opentui 内部组件，不碰 |
| 拆分 LoopContext | 是好方向，但风险大，单独做 |
| 修改 `consumeStream` 2s 超时 | 需要理解 AI SDK 内部实现，风险高 |
| 修改 MCP disconnect 逻辑 | 需要了解 MCP 生命周期，单独处理 |

---

## 执行顺序

```
Step 1 (onCleanup) ← 最重要，先上
  ↓
Step 2 (toolStartTimes delete) ← 简单，可并行
Step 3 (subagentStatuses 清理) ← 简单，可并行
  ↓
Step 4 (streamingSegments 防抖) ← 闪烁核心修复
Step 5 (processedMessages key) ← 闪烁核心修复
  ↓
Step 6 (onIntermediateText 平滑) ← 依赖 Step 4
  ↓
Step 7 (prompt 模块级变量) ← 独立，可并行
  ↓
Step 8 (segment flush timer 清理) ← 依赖 Step 4
```

**并行策略**：Step 2/3 与 Step 1 可并行；Step 7 与 Step 4-6 可并行。

---

## 风险

| 风险 | 缓解 |
|---|---|
| streamingSegments 防抖导致 thinking/text 段显示延迟 60ms | 60ms 用户不可感知，且与 pendingText 防抖一致 |
| processedMessages key 修改可能影响 `<For>` reconciliation | 备选方案更安全（直接用 `messages()` 做 each） |
| onIntermediateText batch 包裹改变时序 | 需要手动测试多轮工具调用场景 |
| onCleanup 中恢复 SIGINT 处理器可能与 Bun 的 SIGINT 处理冲突 | Bun 进程退出时 SIGINT 处理器自然清理 |

---

## 验收标准

- [ ] `bunx tsc --noEmit --skipLibCheck` 编译通过
- [ ] `bun test packages/tui` 全部通过
- [ ] 手动测试：流式输出无闪烁
- [ ] 手动测试：多轮工具调用无闪烁
- [ ] 手动测试：长会话（>20 轮）内存无持续增长（通过 `process.memoryUsage()` 观察）
- [ ] `bun run dev` 启动正常，所有功能正常

---

## 相关文档

- [docs/plans/tui-render-optimization.md](./tui-render-optimization.md) — StreamStore 长期方案（未实施）
- [docs/plans/archive/streaming-chunked-display.md](./archive/streaming-chunked-display.md) — 流式分块展示

---

## 代码审查（提交 eaf29dd）

审查日期：2026-07-31

### 实施与计划的偏差

| 计划步骤 | 计划方案 | 实际实施 | 说明 |
|----------|---------|---------|------|
| Step 5 | processedMessages 加 stable key，修改返回结构 | 改用 `<For each={messages()}>` + `toolBatchInfo` memo 分离 | 实际方案更优，让 SolidJS 直接用 Message 引用做 keyed diff |
| Step 7 | 模块级变量移到组件内 ref | 仅添加 `onCleanup` 清理，未改动模块级变量 | 未完全实施，见问题 #6 |

### 问题清单

| # | 严重度 | 文件 | 行号 | 问题 |
|---|--------|------|------|------|
| 1 | 🔴 Bug | `message-list.tsx` | 22 | 注释被乱码：`<ä­�等` 应为 `<tool_call>等`，疑似编码问题 |
| 2 | 🟡 设计 | `loop.tsx` | 162-183 | `onCleanup` 与 SIGINT handler 有重复清理逻辑（都执行 `removeAllListeners` + 恢复原始处理器），SIGINT 触发后 `onCleanup` 再执行会重复操作 |
| 3 | 🟡 设计 | `loop.tsx` | 438-452 | `_latestClosedSegments` 用 `.push(...closed)` 追加，但 `_flushSegments` 读后未清空原引用就 `setStreamingSegments(prev => [...prev, ...])`，若 flush 期间有新 segment 追加可能重复（概率低但逻辑不严谨） |
| 4 | 🟡 正确性 | `message-list.tsx` | 277 | tool-batch 展开时只渲染了 `firstMsgId` 对应的那条 `MessageItem`，批次中其他 tool 消息未渲染，展开后用户只看到第一条工具调用 |
| 5 | 🟡 性能 | `loop.tsx` | 547-553 | `onStreamText` 中 `_latestClosedSegments.push(...closed)` 每次展开数组，高频调用时有 GC 压力 |
| 6 | 🟢 改进 | `prompt/index.tsx` | 62-67 | `onCleanup` 清理了模块级变量，但 `focusFn`/`setTextFn`/`prependTextFn` 仍在模块作用域，多 Prompt 实例场景下仍是共享状态 |
| 7 | 🟢 改进 | `loop.tsx` | 183 | `scheduler` 在 `onCleanup` 中 `deleteAll()`，但 `onCleanup` 注册在 `scheduler` 创建之前，依赖闭包捕获变量，实际能工作但顺序依赖不够明显 |
| 8 | 🟢 杂项 | `docs/plans/...` | — | 计划文档 Step 5/Step 7 未完全按计划实施，但 Step 5 的替代方案更优 |

### 已修复（2026-07-31）

- [x] **#4**：tool-batch 展开逻辑修复 — 改为在 `<For>` 外渲染展开的批次内容，确保所有消息都显示
- [x] **#1**：乱码注释恢复 — `<tool_call>` 替代乱码字符
- [x] **#2**：SIGINT handler 重复清理 — 添加 `sigintHandled` 标志避免重复恢复
- [x] **#3**：_latestClosedSegments 竞态风险 — 先保存并立即清空原引用，再调用 `setStreamingSegments`
- [x] **#5**：_latestClosedSegments GC 压力 — 用 `for...of` 循环替代 `push(...closed)`
- [x] **#6**：prompt 模块级变量迁移为 context — 通过 `registerInputFns`/`unregisterInputFns` 注册到 LoopContext

### 待修复

- [ ] #7：scheduler 顺序依赖（可选优化）
- [ ] #8：计划文档更新（已完成）
