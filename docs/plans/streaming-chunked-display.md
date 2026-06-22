# 流式输出分块展示 实施计划

**目标**：让 LLM 思考时间和回复内容**渐进式展示**，每收到一段闭合的 `<thinking>` / `<system-reminder>` 立刻推送，剩余未闭合的 chunk 暂时当正文显示。等下一段闭合后再次推送。

**日期**：2026-06-22
**前置**：已经摸清现状（`generateText` 非流式 + `onStreamText` 接收完整文本）

---

## 现状问题

```
[用户] 帮我重构这个模块
[30 秒等待... spinner 转着...]
[突然] 思考：好的，我先看代码...
        计划：1. 看入口 2. 画依赖图 3. 提取共性
        回答：我已经分析完了，接下来开始改...
        （2 屏内容一下子全出来）
```

体验差的核心：**静默 30 秒 + 突然 2 屏**。

## 目标效果

```
[用户] 帮我重构这个模块
[思考 1 闭合，立刻展示]
[思考 2 闭合，立刻展示]
[计划 闭合，立刻展示]
[正文 1 段，~50ms 推一次]
[正文 2 段...]
[Done]
```

---

## 现状代码位置

| 文件 | 关键点 |
|---|---|
| `packages/core/phases/execute.ts:362-369` | `generateText` 等待完整响应才返回 |
| `packages/core/phases/execute.ts:391-401` | 一次性调 `ctx.onStreamText?.(result.text)` 传完整文本 |
| `packages/tui/context/loop.tsx:94` | `streamingText` signal 是整段字符串 |
| `packages/tui/context/loop.tsx:387-394` | buffer 累加 + setStreamingText 每次设整段 |
| `packages/tui/component/message-list.tsx:178-183` | `deriveThinkingDisplay(streamingText(), false)` 渲染 |
| `packages/tui/util/thinking-display.ts` | 4 种 kind 的解析器，已兼容流式（`isComplete=false` 也能跑） |

---

## 完整发现的问题清单

### 🔴 高严重度

| # | 问题 | 位置 | 影响 |
|---|---|---|---|
| 1 | `generateText` 非流式 | `execute.ts:362` | 整个问题根源 |
| 2 | `onStreamText` 接收完整文本 | `execute.ts:400` | 改成流式时必须改这个 API 契约 |
| 3 | `streamingText` 是整段字符串 | `loop.tsx:94` | 必须改成段数组（已闭合段 + 未闭合段） |
| 4 | `deriveThinkingDisplay` 每帧重解析 | `message-list.tsx:178` | 流式时每字符都重正则，性能浪费 |

### 🟡 中严重度

| # | 问题 | 位置 | 影响 |
|---|---|---|---|
| 5 | chunk 可能从标签中间切开 | `streamText` 行为 | 半个 `<thinking>` 进一个 chunk |
| 6 | thinking 闭合后没"清场" | `loop.tsx:393` | 老的 `streamingBuffer = ""` 逻辑会丢内容 |
| 7 | 中间轮（tool call）的 text 走 `onIntermediateText` | `execute.ts:395-397` | 还要保留，不要破坏 |

### 🟢 低严重度

- `deriveThinkingDisplay` 已经支持 `isComplete=false`，兼容流式
- `thinking-view.tsx` 接受 `display` 对象，结构解耦

---

## 步骤

### Phase 1：抽 accumulator 纯函数（最重要）

- [ ] **Step 1：新建 `packages/tui/util/stream-accumulator.ts`**
  - 设计状态机：
    ```ts
    type Segment =
      | { kind: 'thinking'; text: string }     // 已闭合
      | { kind: 'system-reminder'; text: string } // 已闭合
      | { kind: 'text'; text: string }         // 正文（已闭合或未闭合）
    
    type AccState = {
      // 已闭合的段，可以立即展示
      closed: Segment[]
      // 当前正在累积的段（包括未闭合的正文、未闭合的 thinking 等）
      buffer: string
      // 当前 buffer 属于哪种段（'text' | 'in-thinking' | 'in-system-reminder'）
      mode: 'text' | 'in-thinking' | 'in-system-reminder'
    }
    ```
  - 实现 `push(state, chunk): AccState`
    - 累积到 buffer
    - 检测闭合：
      - `in-thinking` 模式：找到 `</thinking>` 时切段，closed push，剩余进 buffer
      - `in-system-reminder` 模式：找到 `</system-reminder>` 时切段
      - `text` 模式：找到 `<thinking>` 或 `<system-reminder>` 时切段（之前是 text），切出新模式
    - 处理跨 chunk 的标签：`<thin` + `king>...</thinking>` 跨两个 chunk 进，先 buffer，等闭合再切
  - 暴露：
    ```ts
    export function createStreamAccumulator(): {
      push(chunk: string): { closed: Segment[]; pending: string }
      reset(): void
    }
    ```
  - **verify**：单测 8 个 case 覆盖：
    1. 纯文本跨多 chunk
    2. `<thinking>...</thinking>` 完整 chunk
    3. `<thinking>...</thinking>` 跨 2 个 chunk（标签分两半）
    4. `<thinking>...</thinking>` 跨 3 个 chunk（开头、闭合、之后）
    5. `<system-reminder>...</system-reminder>` 同样的边界
    6. thinking 后接正文
    7. 多个 thinking 连续
    8. 未闭合的正文（LLM 输出到一半 streamText 失败）

- [ ] **Step 2：写单测 `packages/tui/util/__tests__/stream-accumulator.test.ts`**
  - 覆盖 Step 1 列的 8 个 case
  - **verify**：`bun test packages/tui/util/__tests__/stream-accumulator.test.ts` 全过

### Phase 2：execute.ts 改用 streamText

- [ ] **Step 3：替换 generateText → streamText**
  - `packages/core/phases/execute.ts:362-369`：
    ```ts
    // 旧
    const result = await generateText({
      model: ctx.model,
      system: fullSystem,
      messages: msgs,
      tools,
      temperature: 0.7,
      ...(ctx.signal ? { abortSignal: ctx.signal } : {}),
    })
    
    // 新
    const result = streamText({
      model: ctx.model,
      system: fullSystem,
      messages: msgs,
      tools,
      temperature: 0.7,
      abortSignal: ctx.signal,
      onChunk({ chunk }) {
        if (chunk.type === 'text-delta') {
          ctx.onStreamText?.(chunk.text ?? chunk.delta ?? '')
        }
      },
    })
    
    // await result 仍然返回完整响应（result.text / result.toolCalls 都有）
    ```
  - **verify**：`bunx tsc --noEmit --skipLibCheck` 0 error

- [ ] **Step 4：保持 onStreamText 契约**
  - 接口不变：`(text: string) => void`，但 text 现在是 **delta 增量**而不是整段
  - 需要更新 loop.tsx 里的 `streamingBuffer += text` 逻辑（下一阶段改）
  - 中间轮 `onIntermediateText` 仍然在 `streamText` 完成后调（用 `result.text` 整体）
  - **verify**：tui/app.tsx 那边能跑

### Phase 3：loop.tsx 改造为段累积

- [ ] **Step 5：替换 streamingBuffer 为 accumulator**
  - `packages/tui/context/loop.tsx:94, 387-394`：
    ```ts
    // 旧
    const [streamingText, setStreamingText] = createSignal("")
    let streamingBuffer = ""
    onStreamText: (text: string) => {
      streamingBuffer += text
      setStreamingText(streamingBuffer)
    },
    
    // 新
    const [streamingSegments, setStreamingSegments] = createSignal<Segment[]>([])
    const [pendingText, setPendingText] = createSignal("")
    const acc = createStreamAccumulator()
    onStreamText: (delta: string) => {
      const { closed, pending } = acc.push(delta)
      if (closed.length > 0) {
        setStreamingSegments([...streamingSegments(), ...closed])
      }
      if (pending !== pendingText()) {
        setPendingText(pending)
      }
    },
    onIntermediateText: (text: string) => {
      // 中间轮一次性把当前段收尾，然后整个块作为新消息
      acc.reset()
      setStreamingSegments([])
      setPendingText("")
      addMessage({ role: "assistant", content: text })
    },
    ```
  - **verify**：tui 流式不报错

### Phase 4：message-list 渲染闭合段

- [ ] **Step 6：message-list.tsx 接收段数组**
  - `packages/tui/component/message-list.tsx:178-183`：
    ```tsx
    // 旧
    <Show when={streamingText()}>
      <ThinkingView
        display={deriveThinkingDisplay(streamingText(), false)}
        streaming={true}
      />
    </Show>
    
    // 新
    <Show when={streamingSegments().length > 0 || pendingText()}>
      <For each={streamingSegments()}>
        {(seg) => {
          if (seg.kind === 'thinking') {
            return <ThinkingView display={{ kind: 'thinking-only', thinking: seg.text }} />
          }
          if (seg.kind === 'system-reminder') {
            // system-reminder 是注入元数据，不展示
            return null
          }
          return <text>{seg.text}</text>
        }}
      </For>
      <Show when={pendingText()}>
        <text>{pendingText()}</text>
      </Show>
    </Show>
    ```
  - 已闭合的段不再走 `deriveThinkingDisplay` 解析（避免每帧重解析）
  - **verify**：流式时 thinking 闭合后立刻出现，正文跟着流

### Phase 5：thinking-view 简化

- [ ] **Step 7：thinking-view 接受简单的 `{kind, thinking}` 不需要解析**
  - `packages/tui/component/thinking-view.tsx` 可以保留原 `display` 类型不变（兼容旧调用），但 `message-list` 不再传完整 `deriveThinkingDisplay` 结果
  - 评估 `deriveThinkingDisplay` 是否还需要存在 —— 它仍然给"已完成消息"渲染用
  - **verify**：旧的非流式消息（session 历史）还能正常显示

### Phase 6：测试

- [ ] **Step 8：单测**
  - Step 2 的 accumulator 单测（8 个 case）
  - **verify**：`bun test` 全过

- [ ] **Step 9：手动验证**
  - `bun run dev`
  - 问 LLM 一个会输出 thinking 的问题（比如"重构这个模块"）
  - 观察：
    - 思考段**逐个出现**（不再静默等待）
    - 思考段闭合后**不消失**
    - 正文段在思考段后面**流式出现**
    - 不再有"突然 2 屏"
  - **verify**：录屏或截图确认效果

### Phase 7：文档 + 提交

- [ ] **Step 10：CHANGELOG 更新**
  - Unreleased：
    ```
    ### 体验
    - **流式响应分块展示**：generateText 改 streamText，每收到闭合的 <thinking> / <system-reminder> 段立刻展示，未闭合段暂时当正文流式显示。消除"30 秒静默 + 突然 2 屏"的体验断层。
    ```
  - **verify**：CHANGELOG.md 内容更新

- [ ] **Step 11：commit**
  - 拆 2 个 commit：
    1. `feat: 流式 accumulator + execute 改 streamText`
    2. `feat: message-list 渲染闭合段 + 文档同步`
  - **verify**：`git log --oneline -2` 显示

---

## 涉及文件

| 文件 | 操作 |
|---|---|
| `packages/tui/util/stream-accumulator.ts` | 新建（段切分状态机） |
| `packages/tui/util/__tests__/stream-accumulator.test.ts` | 新建（8 个 case） |
| `packages/core/phases/execute.ts` | 改：generateText → streamText + onChunk |
| `packages/tui/context/loop.tsx` | 改：streamingBuffer → accumulator |
| `packages/tui/component/message-list.tsx` | 改：渲染段数组而不是单一 streamingText |
| `CHANGELOG.md` | 改：Unreleased 加流式体验条目 |

---

## 不做什么

| 项 | 原因 |
|---|---|
| 不改 `deriveThinkingDisplay` API | 旧 API 仍然给"已完成消息"渲染用 |
| 不改 `thinking-view.tsx` 内部 | 接收 `display` 对象已经够灵活 |
| 不改 `onIntermediateText` 流程 | 中间轮（tool call）的整段文本直接作为消息存档 |
| 不做后端 streaming 优化 | 这是前端展示层的事 |
| 不动 `onStreamText` 的回调签名 | 保持 `(text: string) => void`，含义从"整段"改为"delta 增量" |

---

## 验收

完成后：
1. ✅ `stream-accumulator` 8 个 case 单测全过
2. ✅ `execute.ts` 改用 `streamText`，tsc 0 error
3. ✅ `loop.tsx` 用 accumulator 累积
4. ✅ `message-list.tsx` 渲染闭合段
5. ✅ 手动验证：思考段逐个出现，不再有静默期
6. ✅ CHANGELOG 同步
7. ✅ 现有测试无回归（其他 200+ 个 case）

---

## 风险

| 风险 | 缓解 |
|---|---|
| 跨 chunk 标签被切两半 | accumulator 用 buffer 攒着，等闭合再切 |
| `streamText` 的 chunk 字段名差异（text vs delta） | Step 3 用 `chunk.text ?? chunk.delta ?? ''` 兼容多版本 |
| 老的非流式 session 历史（已完成消息）走老路径 | `deriveThinkingDisplay` 保留，message-list 已完成消息分支不变 |
| `onStreamText` 含义变化（整段→delta）| 其他调用方要相应改：grep `onStreamText` 一处，只有 loop.tsx 用 |
| 性能：每字符都 push signal 触发重渲染 | accumulator 只在 closed 段出现时 push；pendingText 用 setText 节流（如果有性能问题再加） |

---

## 决策点

### 决策 1：accumulator 放哪？

**选项 A**：`packages/tui/util/stream-accumulator.ts`（推荐）

**选项 B**：`packages/core/util/stream-accumulator.ts`（core 包）

**选 A**。这是 TUI 显示层的逻辑，跟 core 无关。`packages/tui/util/thinking-display.ts` 也是 TUI 的纯函数，同目录。

### 决策 2：要不要保留 `deriveThinkingDisplay`？

**选保留**。已完成消息的渲染还要用它。新增的段渲染逻辑只用于流式。

### 决策 3：中间轮（tool call）的 text 怎么处理？

按用户选 A 的策略：保留现有 `onIntermediateText` 流程（整段文本作为 assistant 消息存档），但流式显示部分用 accumulator。

### 决策 4：是否要做防抖？

**不做**。每字符触发一次 setPendingText 在 SolidJS 里非常便宜（fine-grained reactivity），不需要防抖。如果性能有问题再加。

---

## 工作量

| 步骤 | 时间 |
|---|---|
| Phase 1（accumulator + 单测） | 30 分钟 |
| Phase 2（execute.ts 改 streamText） | 15 分钟 |
| Phase 3（loop.tsx 改造） | 20 分钟 |
| Phase 4（message-list 渲染） | 20 分钟 |
| Phase 5（thinking-view 评估） | 5 分钟 |
| Phase 6（手动验证） | 15 分钟 |
| Phase 7（文档 + commit） | 15 分钟 |
| **合计** | **约 2 小时** |

---

确认后发给 agent。
