# Any 类型分析报告

**日期**：2026-07-31
**分析范围**：5 个核心 TypeScript 文件
**目标**：识别 `any` 类型使用，评估修复风险，提供类型替换建议

---

## 1. `packages/core/subagent.ts`

**文件状态**：存在（272 行）

### any 类型位置

| 行号 | 位置 | any 类型使用 | 建议替换类型 | 风险评估 |
|------|------|-------------|-------------|----------|
| 67 | `spawn()` ctx.model | `model: any` | `LanguageModel` (from "ai") | 低风险 — AI SDK 标准类型 |
| 69 | `spawn()` ctx.messages | `messages: any[]` | `Array<{ role: string; content: MessageContent[] }>` | 低风险 — 项目内部已有此类型 |
| 137 | `result.toolCalls.map` 回调参数 | `(tc: any)` | `DynamicToolCall` (from "ai") | 低风险 — AI SDK 标准类型 |
| 169 | `result.toolCalls.map` 回调参数 | `(tc: any)` | `DynamicToolCall` (from "ai") | 低风险 — AI SDK 标准类型 |
| 211 | `runMultiple()` ctx.model | `model: any` | `LanguageModel` (from "ai") | 低风险 — 同 spawn() |
| 213 | `runMultiple()` ctx.messages | `messages: any[]` | `Array<{ role: string; content: MessageContent[] }>` | 低风险 — 同 spawn() |
| 241 | `buildToolsWithExecute()` 返回类型 | `Record<string, any>` | `Record<string, any>` (保持，tool() 返回类型复杂) | 中风险 — AI SDK tool() 返回类型内部不导出 |
| 249 | `tools` 局部变量类型 | `Record<string, any>` | 同上 | 中风险 — 同上 |
| 257 | `tool()` 调用断言 | `as any` | 可尝试移除，但 tool() 的 inputSchema 类型可能不匹配 | 中风险 — AI SDK 对 inputSchema 有严格校验 |

### 修复说明

- 行 67/211 的 `model: any`：**推荐替换**。`ctx.model` 直接传给 `generateText()`，AI SDK 的 `LanguageModel` 是正确的类型。
- 行 69/213 的 `messages: any[]`：**推荐替换**。`messages` 传给 `generateText()`，AI SDK 接受 `Array<{ role: string; content: ... }>` 形式。
- 行 137/169 的 `(tc: any)`：**推荐替换**。`result.toolCalls` 的元素类型就是 `DynamicToolCall`。
- 行 241/249/257 的工具构建：**暂不建议替换**。AI SDK 的 `tool()` 函数返回类型在内部构造，外部很难精确匹配。保留 `Record<string, any>` 更实用。

---

## 2. `packages/core/session-compactor.ts`

**文件状态**：存在（532 行）

### any 类型位置

| 行号 | 位置 | any 类型使用 | 建议替换类型 | 风险评估 |
|------|------|-------------|-------------|----------|
| 80 | `shouldCompact()` 参数 | `messages: any[]` | `Message[]` (from session/types) 或自定义 `CompactionMessage` | 低风险 |
| 112 | `compact()` 参数 | `messages: any[]` | 同上 | 低风险 |
| 114 | `compact()` llm 参数 | `llm?: { complete: (req: any) => Promise<any> }` | `llm?: { complete: (req: unknown) => Promise<{ content?: string }> }` | 中风险 — 调用方类型未知 |
| 217 | `summarizeWithLLM()` llm 参数 | `llm: { complete: (req: any) => Promise<any> }` | 同上 | 中风险 |
| 275 | `formatMessagesForSummary()` 参数 | `messages: any[]` | 同第 80 行 | 低风险 |
| 314 | `summarizeToolCall()` 参数 | `input: any` | `Record<string, unknown>` | 低风险 — 宽松但安全 |
| 335 | `extractRules()` 参数 | `messages: any[]` | 同第 80 行 | 低风险 |
| 511 | `estimateTokens()` 参数 | `messages: any[]` | 同第 80 行 | 低风险 |

### 修复说明

- 6 处 `messages: any[]`：**推荐统一修复**。建议定义 `CompactionMessage` 接口：
  ```ts
  interface CompactionMessage {
    role: string
    content: Array<{
      type: string
      text?: string
      toolName?: string
      input?: Record<string, unknown>
      output?: unknown
    }>
  }
  ```
  注意：session/types.ts 的 `Message.content` 是 `string`，而 compactor 需要结构化 content，因此**不能直接用 `Message`**，需要独立接口。

- llm 参数（行 114/217）：**推荐替换**。定义 `LLMCompleter` 接口：
  ```ts
  interface LLMCompleter {
    complete: (req: { model: string; messages: unknown[]; temperature: number; maxTokens: number }) => Promise<{ content?: string }>
  }
  ```

- 行 314 `input: any`：**推荐替换**。`input` 只读取 `.path`/`.command`/`.pattern`，`Record<string, unknown>` 足够。

---

## 3. `packages/core/phases/execute/main.ts`

**文件状态**：存在（540 行）

### any 类型位置

| 行号 | 位置 | any 类型使用 | 建议替换类型 | 风险评估 |
|------|------|-------------|-------------|----------|
| 28 | `LLMResult.usage` 字段 | `usage: any` | `{ inputTokens: number; outputTokens: number; totalTokens?: number }` | 低风险 |
| 55 | `streamText()` 消息传递 | `msgs as any` | 移除断言，调整 msgs 类型为 AI SDK 兼容 | 中风险 — msgs 类型需要扩展 |
| 84 | catch 块 | `streamError: any` | `streamError: unknown` | 低风险 — 标准 catch 类型 |
| 104 | timeout 返回值 | `{} as any` | `{ inputTokens: 0, outputTokens: 0 }` | 低风险 |
| 108 | catch 块 | `e: any` | `e: unknown` | 低风险 |
| 114 | Promise.all usage 默认值 | `{} as any` | `{ inputTokens: 0, outputTokens: 0 }` | 低风险 |
| 223 | filter 回调参数 | `(p: any)` | `MessageContent` (from "./context") | 低风险 — 项目内部类型 |
| 241 | catch 块 | `toolError: any` | `toolError: unknown` | 低风险 |
| 516 | model 断言 | `(ctx.model as any).modelId` | `typeof ctx.model extends { modelId: string } ? ctx.model.modelId : undefined` | 中风险 — LanguageModel 未必有 modelId |
| 525 | usage 断言 | `(result.usage as Record<string, { reasoningTokens?: number }>)` | 定义扩展 usage 类型 | 低风险 |
| 533 | model 断言 | `(ctx.model as any).modelId` | 同行 516 | 中风险 |

### 修复说明

- 行 28 `usage: any`：**推荐替换**。使用 `{ inputTokens: number; outputTokens: number; totalTokens?: number }`。
- 行 55 `msgs as any`：**推荐修复**。`msgs` 包含 `TextPart | ImagePart | ToolCallPart | ToolResultPart`，而 AI SDK 期望特定的 message 结构。建议调整 `buildInitialMessages` 的返回类型。
- 行 84/108/241 catch 块的 `any`：**强烈推荐替换**为 `unknown`，这是 TypeScript 最佳实践。
- 行 516/533 `(ctx.model as any).modelId`：**建议修复**。可通过可选链 + 类型守卫：`(ctx.model as { modelId?: string }).modelId`。AI SDK 的 `LanguageModel` 接口本身不保证有 `modelId` 属性，所以用 `as { modelId?: string }` 更安全。

---

## 4. `packages/session/helpers.ts`

**文件状态**：存在（104 行）

### any 类型位置

| 行号 | 位置 | any 类型使用 | 建议替换类型 | 风险评估 |
|------|------|-------------|-------------|----------|
| 74 | `rowToMessage()` 参数 | `row: any` | 定义 `MessageRow` 接口 | 低风险 |
| 91 | `rowToPart()` 参数 | `row: any` | 定义 `PartRow` 接口 | 低风险 |

### 修复说明

- 行 74 `row: any`：**推荐替换**。定义 `MessageRow` 接口（与 DB schema 对齐）：
  ```ts
  interface MessageRow {
    id: string
    session_id: string
    role: string
    content: string
    agent?: string | null
    model?: string | null
    token_input?: number | null
    token_output?: number | null
    cost?: number | null
    created_at: number
  }
  ```

- 行 91 `row: any`：**推荐替换**。定义 `PartRow` 接口：
  ```ts
  interface PartRow {
    id: string
    message_id: string
    type: string
    content: string
    tool_name?: string | null
    tool_call_id?: string | null
    args?: string | null  // JSON string
    result?: string | null
    metadata?: string | null  // JSON string
    created_at: number
  }
  ```

---

## 5. `packages/tools/types.ts`

**文件状态**：存在（57 行）

### any 类型位置

| 行号 | 位置 | any 类型使用 | 建议替换类型 | 风险评估 |
|------|------|-------------|-------------|----------|
| 25 | `handler` 参数 | `input: any` | 保留 any（泛型方案见下文） | 中风险 |
| 25 | `handler` 返回值 | `Promise<ToolResult<any>>` | `Promise<ToolResult<unknown>>` | 低风险 |

### 修复说明

- 行 25 的 `handler` 定义：**暂不建议改动**。当前 `ToolDefinition` 没有泛型参数，如果改为泛型：
  ```ts
  interface ToolDefinition<TInput = unknown, TOutput = unknown> {
    handler: (input: TInput, ctx: ToolContext) => Promise<ToolResult<TOutput>>
  }
  ```
  则所有 39 个工具的注册代码都需要修改，改动面过大。**建议作为单独重构任务处理**。

- 简单替换 `ToolResult<any>` → `ToolResult<unknown>` 是低风险的，但需确认调用方不会依赖 `any` 的隐式类型转换。

---

## 总体统计

| 文件 | any 数量 | 低风险 | 中风险 | 建议优先级 |
|------|---------|--------|--------|-----------|
| `subagent.ts` | 9 | 6 | 3 | 高 |
| `session-compactor.ts` | 8 | 6 | 2 | 高 |
| `phases/execute/main.ts` | 11 | 7 | 4 | 高 |
| `session/helpers.ts` | 2 | 2 | 0 | 中 |
| `tools/types.ts` | 2 | 0 | 2 | 低 |
| **总计** | **32** | **21** | **11** | - |

---

## 推荐修复顺序

### 第一批：低风险、高收益（~30 分钟）

1. **`helpers.ts`**：定义 `MessageRow` + `PartRow` 接口（2 处）
2. **`execute/main.ts`** catch 块：`any` → `unknown`（3 处，行 84/108/241）
3. **`execute/main.ts`** usage 默认值：`{} as any` → 具体类型（2 处，行 104/114）
4. **`subagent.ts`** 回调参数：`(tc: any)` → `DynamicToolCall`（2 处，行 137/169）

### 第二批：中风险、核心改进（~1 小时）

5. **`subagent.ts`** ctx 类型：`model: any` → `LanguageModel`，`messages: any[]` → 具体类型（4 处，行 67/69/211/213）
6. **`session-compactor.ts`**：定义 `CompactionMessage` + `LLMCompleter` 接口（8 处）
7. **`execute/main.ts`** model 断言：`(ctx.model as any).modelId` → 类型守卫（2 处）

### 第三批：低优先级、改动面大（单独任务）

8. **`tools/types.ts`** `ToolDefinition` 泛型化（影响 39 个工具）
9. **`subagent.ts`** tool() 构建部分（行 241/249/257）— 保留 `any` 更实用

---

## 注意事项

- 每次修改后运行 `bunx tsc --noEmit --skipLibCheck` 验证
- AI SDK 的类型导出不完整，部分类型只能通过 `as` 断言适配
- `session-compactor.ts` 的 `messages` 参数与 `session/types.ts` 的 `Message` 不同（content 是结构化 vs 字符串），不能直接复用
- catch 块的 `any` → `unknown` 是无风险的改进，应立即修复
