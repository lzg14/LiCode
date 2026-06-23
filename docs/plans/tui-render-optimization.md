# TUI 渲染优化 实施计划

**目标**：解决"一轮对话结束后，历史对话的数据已渲染过、却仍被反复触碰"的问题。完成后：
- 已完成消息渲染一次后**零响应式开销**
- 流式 chunk 只触发**最后一段**的局部重渲染
- 1000+ 条历史下，新加一条消息**仍 O(1)**

**日期**：2026-07-22
**前置**：
- 当前 `loop.tsx` 走 `generateText` 一次性 addMessage，未来切到 `streamText` 后问题会立刻暴露
- opentui `useElementBounds` / `<scrollbox stickyScroll>` 可用
- [docs/plans/streaming-chunked-display.md](./streaming-chunked-display.md) 解决了"分块展示"但**没解决"重渲染范围"**

---

## 现状问题

```
onStreamText  ──▶  addMessage()  ──▶  setMessages([...prev, msg])
                                              │
                  ┌───────────────────────────┼─────────────────────────────┐
                  ▼                           ▼                             ▼
            <For history>               <For completed>              QueueMessages memo
            （外层 reconcile）           （外层 reconcile）            （filter 重算）
                  │
                  ▼
              MessageItem(msg)
                  │
                  ▼
   stripSystemTags(content)  +  deriveThinkingDisplay(cleaned, true)
   （每次 props.msg 变化都重算）
                  │
                  ▼
            <markdown content={...} streaming={...}>
            （opentui 内部重解析 + 重布局）
```

**核心事实**：
- 当前是 `generateText` 一次性 addMessage，`<For>` keyed diff 已能避免已存在项的 factory 重新调用
- **但**：消息数组整体被通知时，外层 scrollbox 高度重算 + `QueueMessages` filter memo 重算 + `contextTokens` 累计全数组
- **未来切到 `streamText` 后**：每 chunk 都会让最后一条 message props 变化 → `MessageItem` 内部 `stripSystemTags` / `deriveThinkingDisplay` / `<markdown>` 全链路过一遍

### 🔴 高严重度

| # | 问题 | 位置 | 影响 |
|---|---|---|---|
| 1 | 单一 `messages` signal 承载所有变更 | `packages/tui/context/loop.tsx: addMessage` | history / completed / streaming 互相干扰 |
| 2 | `contextTokens` memo 累计全数组字符 | `packages/tui/context/loop.tsx: contextTokens` | 每新增消息 O(n) 累加 |
| 3 | `MessageItem` 内 `stripSystemTags` + `deriveThinkingDisplay` 每次 props 变化都重算 | `packages/tui/component/message-list.tsx: MessageItem` | 流式时每 chunk 重新正则 + 解析 |
| 4 | `<markdown content={...}>` 每 chunk 整段重渲染 | 同上 | opentui markdown 渲染管线全跑一遍 |
| 5 | `QueueMessages` filter memo 每次消息数组变更都跑 | `message-list.tsx: QueueMessages` | 每次新增全数组 filter |

### 🟡 中严重度

| # | 问题 | 位置 | 影响 |
|---|---|---|---|
| 6 | `useTheme()` 在每个 MessageItem 内订阅，N 个组件订阅同一 signal | `message-list.tsx` 多处 | 主题切换时全量重渲染（可接受），但增加追踪开销 |
| 7 | history signal 启动时一次性 setMessages 整组历史 | `loop.tsx: onMount` | 大历史恢复时整组进 reactive 系统 |
| 8 | scrollbox `stickyScroll="bottom"` 每条新消息都触发滚动逻辑 | `home.tsx` | 每次新增触发 reflow |

### 🟢 低严重度

- 主题切换应该重渲（业务需求）
- `stickyScroll` 是必须的体验，不能改

---

## 目标效果

```
[Phase 2 之后的数据流]

        ┌────────────────────────────────────────────────────┐
        │  StreamStore（新增状态机）                           │
        │                                                     │
        │  history     ─── 永不变，一次性 loadHistory          │
        │     │           ▼                                   │
        │     │        FrozenMessage（无 signal 订阅）        │
        │     │                                                │
        │  completed   ─── append 模式，已存在 ref 不变        │
        │     │           ▼                                   │
        │     │        CompletedMessage（只订阅自己 msg）      │
        │     │                                                │
        │  streaming   ─── 单条 mutable，content 独立 signal   │
        │     ▼           ▼                                   │
        │  StreamingMessage（独立订阅）                        │
        └────────────────────────────────────────────────────┘
```

**指标对比**：

| 指标 | 当前 | 目标 |
|------|------|------|
| 1000 条历史下，新增一条消息的 reconcile 量 | O(n) | O(1) |
| 流式 chunk 到达时，重渲染的组件数 | 1 项 + 外层 reconcile | **只 1 个 StreamingMessage 内部** |
| 派生计算（strip/derive）次数 | 每次 props 变都重算 | 同一 message 对象只算 1 次 |
| `contextTokens` 累加 | 全数组每次 | 增量 |

---

## 核心思路

**数据层就分开**，而不是在渲染层 hack。Solid 的响应式系统会自然只追踪到对应通道：

1. **history**：永不被 set（除了启动时 `loadHistory` / `freezeCompleted`）→ FrozenMessage 渲染一次后零订阅
2. **completed**：append-only 模式 → `<For>` keyed diff O(1)
3. **streaming**：独立 signal，最多 1 条 message → 只有 StreamingMessage 订阅

---

## 实施步骤

### Phase 1：派生计算缓存（最小改动，最高 ROI）

> **优先级最高**。零风险，立刻能上。约 1 小时。

- [ ] **Step 1.1**：新建 `packages/tui/util/message-cache.ts`
  - 暴露 `getCleaned(msg: Message): string`
  - 暴露 `getDisplay(msg: Message): ThinkingDisplay`
  - 内部用 `WeakMap<Message, ...>` 缓存
  - **关键**：流式消息**不走 cache**（content 每 chunk 变，对象引用也变），由调用方决定

- [ ] **Step 1.2**：改造 `packages/tui/component/message-list.tsx: MessageItem`
  - 内部所有 `stripSystemTags(props.msg.content)` 改为 `getCleaned(props.msg)`
  - 内部所有 `deriveThinkingDisplay(cleaned, true)` 改为 `getDisplay(props.msg)`
  - **不动 streaming 路径**（`onStreamText` 那条路目前是整条 addMessage，但下一步会改）

- [ ] **Step 1.3**：写单测 `packages/tui/util/__tests__/message-cache.test.ts`
  - 同一 message 多次访问只算一次
  - 不同 message 独立缓存
  - message 引用消失后 WeakMap 自动 GC（不显式测）

**验收**：vitest 跑过；perf 角度 1000 条已完成消息渲染 0 次派生计算。

---

### Phase 2：新增 StreamStore（核心改动）

> **核心收益来源**。约 1-2 天。

- [ ] **Step 2.1**：新建 `packages/tui/state/stream-store.ts`

  ```ts
  // 完整代码（落地时实现）
  export function createStreamStore() {
    const [history, setHistory] = createSignal<Message[]>([])
    const [completed, setCompleted] = createSignal<Message[]>([])
    const [streaming, setStreaming] = createSignal<StreamMessage | null>(null)

    return {
      // readers
      history, completed, streaming,
      isStreaming: () => streaming() !== null,
      // writers
      loadHistory(msgs) { setHistory(msgs) },
      appendCompleted(msg) {
        setCompleted(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg])
      },
      startStreaming(msg) { setStreaming({ ...msg, content: msg.content ?? '' }) },
      appendStreamingChunk(chunk) {
        setStreaming(prev => prev ? { ...prev, content: prev.content + chunk } : prev)
      },
      updateStreaming(patch) {
        setStreaming(prev => prev ? { ...prev, ...patch } : prev)
      },
      finalizeStreaming() {
        batch(() => {
          const cur = streaming()
          if (cur) setCompleted(prev => [...prev, cur as Message])
          setStreaming(null)
        })
      },
      freezeCompleted() {
        batch(() => {
          setHistory(prev => [...prev, ...completed()])
          setCompleted([])
        })
      },
      clearAll() {
        batch(() => { setHistory([]); setCompleted([]); setStreaming(null) })
      },
    }
  }
  ```

- [ ] **Step 2.2**：新建 `packages/tui/state/stream-store.tsx`（Provider + hook）
  - `StreamStoreProvider` 包裹整棵树（放在 `LoopProvider` 外层）
  - `useStreamStore()` hook

- [ ] **Step 2.3**：改造 `packages/tui/context/loop.tsx`
  - 在 `LoopProvider` 内 `const streamStore = createStreamStore()`
  - 启动 `onMount` 恢复历史时改用 `streamStore.loadHistory(...)`
  - `addMessage` 内部路由：
    - 若是 streaming 中的 assistant 内容 → `streamStore.appendStreamingChunk(content)`
    - 否则 → `streamStore.appendCompleted(msg)`
  - `updateMessage` 内部路由：
    - 若 id === `streaming().id` → `streamStore.updateStreaming(patch)`
    - 否则 → 替换 completed 中的项（保留 append 模式，重新构造数组）
  - `onStreamText` 路由：
    ```ts
    onStreamText: (text) => {
      if (!streamStore.isStreaming()) {
        streamStore.startStreaming({ id: `stream_${ts()}`, role: 'assistant', timestamp: Date.now() })
      }
      streamStore.appendStreamingChunk(text)
    }
    ```
  - `onToolResult` / `onToolCall` 路由：
    ```ts
    onToolCall: (...) => {
      streamStore.finalizeStreaming()  // 先结束当前流
      streamStore.appendCompleted({ role: 'tool', ... })
    },
    onToolResult: (result) => {
      // 找到刚加的 tool 消息，更新它
      // 用 updateMessage 走原路径
    }
    ```
  - `run` 结束时（`finally` 块）：
    ```ts
    streamStore.finalizeStreaming()
    streamStore.freezeCompleted()  // 把本轮所有 completed 合并到 history
    ```
  - `clearSession` / `clearMessages` 路由到 `streamStore.clearAll()`
  - 保留 `messages` accessor（合并三段）作为**过渡期兼容**：
    ```ts
    const messages = createMemo(() => [...streamStore.history(), ...streamStore.completed()])
    ```
  - `contextTokens` 改成增量（每次 appendStreamingChunk 时单独算新增字符数）

- [ ] **Step 2.4**：改造 `packages/tui/component/message-list.tsx`
  - `MessageList` 分三段渲染：
    ```tsx
    <For each={streamStore.history()}>{(msg) => <FrozenMessage msg={msg} />}</For>
    <For each={streamStore.completed()}>{(msg) => <CompletedMessage msg={msg} />}</For>
    <StreamingMessage />
    ```
  - `FrozenMessage`：不订阅 `useTheme()` accessor，**改用 props 传入的主题 snapshot**
  - `CompletedMessage`：订阅 `useTheme()`，但消息对象引用稳定，不订阅消息数组
  - `StreamingMessage`：只订阅 `streamStore.streaming()`
  - `QueueMessages`：只从 `streamStore.completed()` 过滤（不再过滤 streaming）

- [ ] **Step 2.5**：新增 `packages/tui/util/theme-snapshot.ts`
  - `useThemeSnapshot()` 返回主题颜色快照对象
  - `<MessageList>` 顶层调用一次，传给所有 `FrozenMessage`

- [ ] **Step 2.6**：单测 `packages/tui/state/__tests__/stream-store.test.ts`
  - `loadHistory` 后 `history()` 返回；再 `loadHistory` 应替换（不合并）
  - `appendCompleted` 同 id 不重复
  - `startStreaming` 后 `appendStreamingChunk` 累加 content
  - `finalizeStreaming` 把 streaming 移入 completed，`streaming()` 变 null
  - `freezeCompleted` 把 completed 合并到 history，completed 变空
  - 三个 signal 之间互不通知

**验收**：
- `vitest` 跑过所有现有测试 + 新单测
- dev logger 加埋点：每 chunk 打印 `[RENDER] streaming updated` 验证只有 streaming 区触发
- 手动测：长会话下新加一条消息，scrollbox 不重排整组

---

### Phase 3：删除 `LoopContext.messages` 兼容层

> 等所有消费方迁到 `useStreamStore()` 后再删。约 0.5 天。

- [ ] **Step 3.1**：全局 grep `useLoop().messages` 的消费方
  - 预期消费方：`message-list.tsx`、`sidebar.tsx`、`status-bar.tsx`、`home.tsx`、其他
- [ ] **Step 3.2**：逐个改成 `useStreamStore().history() + completed()` 或 `useStreamStore().streaming()`
- [ ] **Step 3.3**：从 `LoopContext` 删 `messages`
- [ ] **Step 3.4**：删 `LoopContext` 里的 `messages` 派生 memo

**验收**：`grep -r "useLoop().messages" packages/` 0 结果。

---

### Phase 4：视口虚拟化（可选）

> 仅长会话（>200 条）有意义。约 1 天。

- [ ] **Step 4.1**：调研 opentui `useElementBounds` API
- [ ] **Step 4.2**：新增 `packages/tui/component/virtualized-message-list.tsx`
  - 用 `<scrollbox>` 的 scrollTop + viewport 高度
  - 只渲染视口上下各 5 个 MessageItem
  - 用占位 box 撑出顶部/底部空间
- [ ] **Step 4.3**：行高估算策略
  - 方案 A：固定 `ITEM_HEIGHT_ESTIMATE = 4`（简单，markdown 长内容会估错）
  - 方案 B：用 `measureElement` 实测（精确，但需要 layout 反馈循环）
  - 建议先用方案 A，超出 200 条才用虚拟化
- [ ] **Step 4.4**：`home.tsx` 根据消息总数切换 `MessageList` vs `VirtualizedMessageList`

**验收**：1000 条历史下手动滚动，FPS 稳定 ≥ 50。

---

### Phase 5：拆分 LoopContext（可选）

> 进一步隔离副作用。约 1 天。

- [ ] **Step 5.1**：把 `LoopContext` 拆成 3 个：
  - `RunContext`：`run` / `abort` / `isProcessing` / `elapsed`
  - `LoopStatsContext`：`llmCallCount` / `llmTokenUsage` / `currentModel`
  - `SchedulerContext`：`scheduler` / `addLoop` / `stopLoops` / `listLoops`
- [ ] **Step 5.2**：`StatusBar` 只订阅 `LoopStatsContext`
- [ ] **Step 5.3**：`Sidebar` 只订阅 `SchedulerContext`
- [ ] **Step 5.4**：`Prompt` 只订阅 `RunContext`

**验收**：dev tools 验证 StatusBar 渲染时不影响 MessageList 订阅链。

---

## 数据模型

### `packages/tui/state/stream-store.ts`

```ts
import { createSignal, batch, type Accessor } from "solid-js"

export interface Message {
  id: string
  role: "user" | "assistant" | "system" | "tool"
  content: string
  timestamp: number
  toolName?: string
  toolArgs?: Record<string, unknown>
  toolStatus?: "pending" | "running" | "completed" | "error"
  toolBatch?: number
  duration?: number
  diff?: string
  queued?: boolean
  images?: Array<{ base64: string; mimeType: string }>
}

export interface StreamMessage {
  id: string
  role: "assistant" | "tool"
  content: string
  timestamp: number
  // 透传其他字段...
}

export interface StreamStore {
  history: Accessor<Message[]>
  completed: Accessor<Message[]>
  streaming: Accessor<StreamMessage | null>
  isStreaming: Accessor<boolean>

  loadHistory(msgs: Message[]): void
  appendCompleted(msg: Message): void
  startStreaming(msg: Omit<StreamMessage, 'content'> & { content?: string }): void
  appendStreamingChunk(chunk: string): void
  updateStreaming(patch: Partial<StreamMessage>): void
  finalizeStreaming(): void
  freezeCompleted(): void
  clearAll(): void
}
```

### 关键不变量

| Signal | 写入时机 | 读取方 | 性质 |
|--------|---------|--------|------|
| `history` | `loadHistory` (启动) / `freezeCompleted` (run 结束) | `FrozenMessage` | **永不被 append 触发** |
| `completed` | `appendCompleted` / `finalizeStreaming` | `CompletedMessage`, `QueueMessages` | append-only，已存在 ref 不变 |
| `streaming` | `startStreaming` / `appendStreamingChunk` / `updateStreaming` / `finalizeStreaming` (清) | `StreamingMessage` | 0 或 1 条 message |

---

## 风险与权衡

| 风险 | 缓解 |
|------|------|
| `freezeCompleted` 把整段 completed merge 进 history 时，trigger 整组 history 通知 | batch 包裹；history 只在 run 之间边界触发，可接受 |
| 派生缓存（WeakMap）在 `appendStreamingChunk` 时失效（content 变） | streaming 路径**显式不走 cache**，调用 `stripSystemTags` + `deriveThinkingDisplay` 直接 |
| 主题切换时 FrozenMessage 不重渲染（用了 snapshot） | 业务上可接受：主题切换是低频操作；如果必须跟随，把 FrozenMessage 改成正常 useTheme 即可 |
| 旧 `LoopContext.messages` 消费方漏改 | Phase 3 之前保留兼容层，TypeScript 编译会卡住漏改的调用 |
| `scrollbox stickyScroll` 在 freezeCompleted 后滚动行为可能异常 | 测一遍，必要时显式 `scrollToEnd()` |
| 调试时状态分散到 3 个 signal | devLogger 临时打印三段长度，足够定位 |

---

## 不要做的事

| ❌ 做法 | 原因 |
|---------|------|
| 用 `immer` / `immutable.js` | Solid 已是最优，引入库反而增加开销 |
| 在渲染层 `untrack(messages)` hack | 应该从数据源头分开，不要从渲染层 hack |
| Web Worker 算 markdown | opentui markdown 是 Zig native，已是最快 |
| 把 `<For>` 换成 `<Index>` | `<Index>` 是按 index diff，本场景是 keyed 更合适 |
| 引入 Virtual DOM | Solid 已是细粒度响应式，不需要换 |
| 把 streaming content 改成数组分块 | 已由 `stream-accumulator.ts` 处理，渲染层不需要重复 |
| 在 `MessageItem` 里判断 `frozen` 后跳渲染 | 容易出 bug；用**数据源分通道**而不是渲染层判断 |

---

## 验收标准

### 性能（Phase 2 完成时）

- [ ] 1000 条 history + 1 chunk 到达：dev logger 打印 `<5ms`
- [ ] 1000 条 history + appendCompleted：dev logger 打印 `<2ms`
- [ ] 1000 条 history + freezeCompleted：dev logger 打印 `<50ms`（含 batch）
- [ ] 长 markdown（10KB）流式更新：每 chunk < 16ms

### 功能

- [ ] 所有现有 vitest 跑过
- [ ] 新增 3 个单测文件：message-cache / stream-store / phase 路由
- [ ] 手动测：多轮对话、/compact、/clear、/loop、Aborted 流、queued 消息
- [ ] 启动时恢复 1000 条历史不卡顿

### 可观察

- [ ] dev logger 临时埋点：每个 store 操作打印一次（run 完成后删除）
- [ ] 在 README / docs 更新"性能"章节

---

## 落地顺序

1. **Phase 1**（1 小时）— 派生计算缓存，立即见效
2. **Phase 2**（1-2 天）— StreamStore 核心，**必做**
3. **Phase 3**（0.5 天）— 删兼容层，清理
4. Phase 4 / 5 按需

**Phase 1 + Phase 2 是必须的**。Phase 1 零风险可以立刻上；Phase 2 是核心收益但需要仔细测边界条件（/loop 队列、/compact 中断、Aborted 流、queued 消息、中间轮 text）。

---

## 相关文档

- [docs/plans/streaming-chunked-display.md](./streaming-chunked-display.md) — 流式分块展示（互补，不重叠）
- [docs/20260617-tui-review.md](../20260617-tui-review.md) — TUI 现状 review
- [docs/modules/audit.md](../modules/audit.md) — 模块审计（可能含相关条目）
