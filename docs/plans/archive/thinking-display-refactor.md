# Thinking 显示逻辑重构计划

**目标**：把 streaming thinking 的 3 种状态逻辑**抽成纯函数 + 单测覆盖**，停止 patch 行为。

**日期**：2026-06-21
**优先级**：P0（已 patch 3 次还没稳）

---

## 现状问题

### git 历史

```
ed8d8ec fix: extractThinking 匹配任意位置的 thinking 标签
aca4d08 fix: thinking 完有回复后不再展示
5b51df2 fix: streaming 时 thinking 内容显示优化
```

3 次修，每次修一个症状。**没单测，没设计**。

### 当前实现（5b51df2）

```tsx
<Show when={streamingText()}>
  {(() => {
    const cleaned = stripSystemTags(streamingText())
    const [thinking, rest] = extractThinking(cleaned)
    return (
      <>
        <Show when={thinking && !rest}>
          <box borderStyle="rounded">
            <text>{`💭 thinking...`}</text>
          </box>
        </Show>
        <Show when={rest}>
          <MarkdownText content={rest} streaming={true} />
        </Show>
      </>
    )
  })()}
</Show>
```

**问题**：
- IIFE + 嵌套三元 + 两个 `<Show>` — 不可读、不可测、不可扩展
- 三种状态分支硬编码在 JSX 里
- 加一种状态（比如折叠展开）就要重写

---

## 设计目标

```
纯函数 deriveThinkingDisplay(streaming, isComplete) → { kind, ... }
组件 ThinkingView({ display }) → switch (kind) 渲染
测试: 覆盖所有 kind 转换
```

---

## 步骤

### Phase 1：测试先行（先写失败用例）

- [ ] **Step 1：写测试用例**
  - 新建 `packages/tui/util/__tests__/thinking-display.test.ts`
  - 覆盖所有状态转换：
    ```ts
    describe('deriveThinkingDisplay', () => {
      // ─── 状态 1: 只有 thinking ──────────────────
      it('streaming + only thinking → thinking-only', () => {
        const r = deriveThinkingDisplay('<thinking>analyzing</thinking>', false)
        expect(r.kind).toBe('thinking-only')
        if (r.kind === 'thinking-only') {
          expect(r.text).toBe('analyzing')
        }
      })
      
      it('streaming + multi-line thinking → thinking-only', () => {
        const r = deriveThinkingDisplay('<thinking>line1\nline2</thinking>', false)
        expect(r.kind).toBe('thinking-only')
      })
      
      it('streaming + unclosed thinking (no </thinking>) → thinking-only', () => {
        const r = deriveThinkingDisplay('<thinking>still going', false)
        expect(r.kind).toBe('thinking-only')
      })
      
      // ─── 状态 2: thinking + 正文 ──────────────────
      it('streaming + thinking + rest → has-rest', () => {
        const r = deriveThinkingDisplay('<thinking>thinking</thinking>\nanswer', false)
        expect(r.kind).toBe('has-rest')
        if (r.kind === 'has-rest') {
          expect(r.thinking).toBe('thinking')
          expect(r.rest).toBe('answer')
        }
      })
      
      it('streaming + thinking + rest + trailing newline → trim rest', () => {
        const r = deriveThinkingDisplay('<thinking>x</thinking>\n\n\n', false)
        expect(r.kind).toBe('no-thinking')  // 全是空，没意义显示
        // 或 has-rest with empty rest
      })
      
      it('streaming + thinking + rest + newlines before rest → strip', () => {
        const r = deriveThinkingDisplay('<thinking>x</thinking>\n\nanswer', false)
        expect(r.kind).toBe('has-rest')
        if (r.kind === 'has-rest') expect(r.rest).toBe('answer')
      })
      
      // ─── 状态 3: 完成后 ─────────────────────────
      it('complete + only thinking → no-thinking (drop thinking)', () => {
        const r = deriveThinkingDisplay('<thinking>only thinking</thinking>', true)
        expect(r.kind).toBe('no-thinking')
      })
      
      it('complete + thinking + rest → no-thinking (drop thinking, show rest)', () => {
        const r = deriveThinkingDisplay('<thinking>think</thinking>\nanswer', true)
        expect(r.kind).toBe('no-thinking')
        if (r.kind === 'no-thinking') {
          expect(r.rest).toBe('answer')
        }
      })
      
      it('complete + no thinking → no-thinking', () => {
        const r = deriveThinkingDisplay('just an answer', true)
        expect(r.kind).toBe('no-thinking')
        if (r.kind === 'no-thinking') {
          expect(r.rest).toBe('just an answer')
        }
      })
      
      // ─── 状态 4: 无内容 ─────────────────────────
      it('empty string streaming → empty', () => {
        const r = deriveThinkingDisplay('', false)
        expect(r.kind).toBe('empty')
      })
      
      it('empty string complete → empty', () => {
        const r = deriveThinkingDisplay('', true)
        expect(r.kind).toBe('empty')
      })
      
      it('only whitespace streaming → empty', () => {
        const r = deriveThinkingDisplay('   \n  ', false)
        expect(r.kind).toBe('empty')
      })
      
      // ─── 边界情况 ─────────────────────────
      it('multiple thinking blocks → 只取第一个', () => {
        const r = deriveThinkingDisplay(
          '<thinking>first</thinking>middle<thinking>second</thinking>rest', false)
        expect(r.kind).toBe('has-rest')
        // 决定：first + rest= "middle second rest"? 还是合并？
      })
      
      it('thinking in middle (not at start) → has-rest with full', () => {
        const r = deriveThinkingDisplay('before<thinking>mid</thinking>after', false)
        expect(r.kind).toBe('has-rest')
        if (r.kind === 'has-rest') {
          expect(r.thinking).toBe('mid')
          expect(r.rest).toBe('before after')
        }
      })
      
      it('nested thinking tags → 贪婪匹配第一个 </thinking>', () => {
        const r = deriveThinkingDisplay('<thinking>a<thinking>b</thinking>', false)
        // 期望 thinking='a<thinking>b', rest=''
        expect(r.kind).toBe('thinking-only')
      })
      
      it('LLM 输出带 thinking 但实际回答含 thinking 字面量', () => {
        const r = deriveThinkingDisplay(
          'To be clear, I am <thinking>really</thinking> the answer', false)
        expect(r.kind).toBe('has-rest')
        if (r.kind === 'has-rest') {
          expect(r.thinking).toBe('really')
          expect(r.rest).toBe('To be clear, I am  the answer')
        }
      })
    })
    ```
  - **verify**：`bun test packages/tui/util/__tests__/thinking-display.test.ts` 全部 FAIL（因为函数还不存在）

- [ ] **Step 2：跑测试确认全失败（红）**
  - 预期：所有测试都失败，错误是"function not found"
  - **verify**：红条

### Phase 2：实现纯函数

- [ ] **Step 3：实现 `deriveThinkingDisplay`**
  - 新建 `packages/tui/util/thinking-display.ts`：
    ```ts
    export type ThinkingDisplay =
      | { kind: 'empty' }
      | { kind: 'thinking-only', text: string }
      | { kind: 'has-rest', thinking: string, rest: string }
      | { kind: 'no-thinking', rest: string }
    
    /**
     * 从 streaming 文本推导应显示什么
     * @param raw LLM 实时输出（含 <thinking> 标签）
     * @param isComplete 消息是否已完成（不再变化）
     */
    export function deriveThinkingDisplay(
      raw: string,
      isComplete: boolean
    ): ThinkingDisplay {
      const cleaned = raw.trim()
      if (!cleaned) return { kind: 'empty' }
      
      // 匹配第一个 <thinking>...</thinking>
      const match = cleaned.match(/<thinking>([\s\S]*?)<\/thinking>/)
      
      if (!match) {
        // 没 thinking 标签
        return { kind: 'no-thinking', rest: cleaned }
      }
      
      const thinking = match[1].trim()
      const rest = cleaned.replace(match[0], '').trim()
      
      // 没正文 → 只有 thinking
      if (!rest) {
        if (isComplete) {
          // 完成后只有 thinking，不显示
          return { kind: 'no-thinking', rest: '' }
        }
        return { kind: 'thinking-only', text: thinking }
      }
      
      // 有 thinking + 正文：总是显示正文（不管 complete 还是 streaming）
      return { kind: 'has-rest', thinking, rest }
    }
    ```
  - **verify**：跑 Step 1 的测试 → 全绿

- [ ] **Step 4：跑测试确认全绿**
  - **verify**：`bun test ...thinking-display.test.ts` 全 pass

### Phase 3：重构组件

- [ ] **Step 5：抽出 ThinkingView 组件**
  - 新建 `packages/tui/component/thinking-view.tsx`：
    ```tsx
    import { Show, Switch, Match } from 'solid-js'
    import { useTheme } from '../context/theme'
    import { MarkdownText } from './markdown-text'
    import type { ThinkingDisplay } from '../util/thinking-display'
    
    export function ThinkingView(props: {
      display: ThinkingDisplay
      streaming?: boolean
    }) {
      const { textMuted } = useTheme()
      return (
        <Switch>
          <Match when={props.display.kind === 'empty'}>
            {/* 不渲染 */}
          </Match>
          
          <Match when={props.display.kind === 'thinking-only'}>
            <Show when={props.display.kind === 'thinking-only'}>
              {(_) => {
                const d = props.display as Extract<ThinkingDisplay, { kind: 'thinking-only' }>
                return (
                  <box
                    marginBottom={1}
                    flexDirection="column"
                    paddingLeft={1}
                    borderStyle="rounded"
                    borderColor={textMuted()}
                  >
                    <text fg={textMuted()}>💭 thinking...</text>
                  </box>
                )
              }}
            </Show>
          </Match>
          
          <Match when={props.display.kind === 'has-rest' || props.display.kind === 'no-thinking'}>
            <Show when={true}>
              {(_) => {
                const d = props.display as Extract<ThinkingDisplay, { kind: 'has-rest' | 'no-thinking' }>
                if (!d.rest) return null
                return (
                  <box marginBottom={1}>
                    <MarkdownText content={d.rest} streaming={props.streaming ?? false} />
                  </box>
                )
              }}
            </Show>
          </Match>
        </Switch>
      )
    }
    ```
  - **verify**：组件能编译

- [ ] **Step 6：替换 message-list.tsx 里的 IIFE**
  - `packages/tui/component/message-list.tsx`：
    - 删 line 193-213 的 IIFE 块
    - 替换为：
      ```tsx
      <Show when={streamingText()}>
        <ThinkingView
          display={deriveThinkingDisplay(streamingText(), false)}
          streaming={true}
        />
      </Show>
      ```
  - 处理已经完成的消息（不是 streaming）也要正确显示：
      ```tsx
      // 已有消息列表的渲染处
      <For each={messages()}>
        {(msg) => (
          <Show when={msg.role === 'assistant'}>
            <ThinkingView
              display={deriveThinkingDisplay(msg.content, true)}
              streaming={false}
            />
          </Show>
        )}
      </For>
      ```
  - **verify**：TUI 中手动测 — streaming 中只有 thinking 显示 💭；完成后 thinking 消失

- [ ] **Step 7：删除旧的 `extractThinking` 函数**
  - `packages/tui/component/message-list.tsx:13` 的 `extractThinking` 函数 — 现在不再直接用
  - 保留为内部 helper 也可以，但建议删（pure function 已在 thinking-display.ts）
  - **verify**：`grep "extractThinking\b" packages/` 只有 tests 或 thinking-display.ts 引用

- [ ] **Step 8：跑全套测试**
  - `bun test packages/tui` 全过
  - tsc 0 错
  - **verify**：100+ tests pass

### Phase 4：端到端验证

- [ ] **Step 9：手动 TUI 测试**
  - 启动 `bun run dev`
  - 让 LLM 调一个简单任务（"1+1=? 看 thinking 是否显示"）
  - 观察：
    - streaming 中：只显示 `💭 thinking...`
    - 出现正文后：只显示正文
    - 完成后：thinking 仍不显示
  - **verify**：3 个场景都符合预期

- [ ] **Step 10：CHANGELOG**
  - Unreleased 条目：
    ```markdown
    ### 重构
    - **Thinking 显示逻辑抽成纯函数**：`deriveThinkingDisplay()` 在 `packages/tui/util/thinking-display.ts`，4 种状态（empty / thinking-only / has-rest / no-thinking）覆盖所有场景
    - **停止 patch 循环**：3 次 bug fix 的根因（streaming 状态机不清晰）通过显式状态机 + 单测一次性解决
    ```

- [ ] **Step 11：提交**
  - 2 个 commit：
    1. `test: thinking-display 纯函数 + 14 个状态转换测试`
    2. `refactor: 替换 IIFE 为 ThinkingView 组件 + 纯函数驱动`
  - **verify**：`git log --oneline -3` 显示

---

## 涉及文件

| 文件 | 操作 |
|---|---|
| `packages/tui/util/thinking-display.ts` | 新建（纯函数） |
| `packages/tui/util/__tests__/thinking-display.test.ts` | 新建（14 测试） |
| `packages/tui/component/thinking-view.tsx` | 新建（组件） |
| `packages/tui/component/message-list.tsx` | 改：替换 IIFE 为 ThinkingView |
| `CHANGELOG.md` | 加 Unreleased |

---

## 不做什么

| 项 | 原因 |
|---|---|
| 不加折叠展开 thinking UI | plan 完成后再说 |
| 不动 thinking extraction 内部 | 抽到 thinking-display.ts |
| 不支持多个 thinking block 合并 | 一个就够，复杂情况再说 |
| 不加 streaming 动画 | 现状够用 |

---

## 验收

完成后：

1. ✅ `bun test packages/tui/util/__tests__/thinking-display.test.ts` 14+ tests 全过
2. ✅ TUI 中 streaming thinking 显示稳定（3 种状态）
3. ✅ 后续改 thinking 逻辑不会回归（单测保护）
4. ✅ tsc 0 错
5. ✅ 全套 tests pass
6. ✅ 不再有"再 patch 一次"的循环

---

## 工作量

| 步骤 | 时间 |
|---|---|
| Phase 1（写测试） | 30 分钟 |
| Phase 2（实现） | 30 分钟 |
| Phase 3（重构） | 1 小时 |
| Phase 4（验证 + commit） | 30 分钟 |
| **合计** | **约 2.5 小时** |

---

## 风险

| 风险 | 缓解 |
|---|---|
| 测试不全面，遗漏 case | Phase 1 写 14 个用例，覆盖 4 kind + 边界 |
| Switch/Match 在 SolidJS 中行为不一致 | 用 Show + kind 比较，标准模式 |
| 已完成消息的回放行为变 | 测 4 个 case（empty/thinking-only/has-rest/no-thinking） |

---

## 决策点

### 决策 1：消息完成后 thinking 完全不显示（推荐）还是折叠？

**推荐 A**：完全不显示
- 简单、用户不被打扰
- 一致行为：thinking 是临时态

**备选 B**：折叠成 `<details>`
- 用户可点开看 reasoning
- 实现复杂（需要 MarkdownText 支持）

**选 A**（本计划）。B 留作未来增强。

### 决策 2：多个 thinking 块怎么处理？

**推荐**：取第一个，丢弃其余。
- LLM 一般只输出一个 thinking
- 多个视为异常，不展示

---

确认后发给 agent。跑完 review。