# 死代码分析报告

**日期**: 2026-07-31

---

## 1. `packages/tui/context/keybind.tsx` — KeybindProvider / useKeybind

- **文件存在**: 是 (43 行)
- **死代码**:
  - `useKeybind()` 函数 (行 39-43): **整个函数无任何消费者**。在整个代码库中，`useKeybind` 仅在自身定义处出现，从未被其他文件调用。
  - `KeybindContext` 接口 (行 10-13): 仅被 `useKeybind` 和 `KeybindProvider` 内部使用。
  - `KeyBinding` 接口 (行 3-8): 仅在 `keybind.tsx` 内部使用。
  - `KeybindProvider` (行 17-37): 在 `app.tsx` 行 192-201 被包裹使用，但其提供的 context **无任何组件消费**。
- **删除安全性**: **安全**。`KeybindProvider` 虽被 `app.tsx` 包裹，但没有任何组件调用 `useKeybind()`，所以包裹和整个文件都是死代码。删除后 `app.tsx` 也需同步移除包裹。

## 2. `packages/tui/ui/dialog.tsx` — DialogProvider / useDialog

- **文件存在**: 是 (44 行)
- **死代码**:
  - `useDialog()` 函数 (行 40-44): **整个函数无任何消费者**。在整个代码库中，`useDialog` 仅在自身定义处出现，从未被其他文件调用。
  - `DialogContext` 接口 (行 9-13): 仅被 `useDialog` 和 `DialogProvider` 内部使用。
  - `DialogProvider` (行 19-38): 在 `app.tsx` 行 193-200 被包裹使用，但其提供的 context **无任何组件消费**。
  - `DialogItem` 接口 (行 4-7): 仅在 `dialog.tsx` 内部使用。
- **删除安全性**: **安全**。与 keybind.tsx 相同，`DialogProvider` 虽被包裹但无消费者。删除后 `app.tsx` 也需同步移除包裹。

## 3. `packages/tui/app.tsx` — KeybindProvider / DialogProvider 包裹

- **文件存在**: 是 (226 行)
- **死代码**:
  - `import { KeybindProvider } from "./context/keybind"` (行 41)
  - `<KeybindProvider>` / `</KeybindProvider>` 包裹 (行 192, 201)
  - `import { DialogProvider } from "./ui/dialog"` (行 46)
  - `<DialogProvider>` / `</DialogProvider>` 包裹 (行 193, 200)
- **删除安全性**: **安全**。移除这两层 Provider 包裹不会影响任何功能，因为它们的 context 没有被任何子组件消费。需在删除 `keybind.tsx` 和 `dialog.tsx` 后同步清理。

## 4. `packages/tui/context/route.tsx` — Route 类型 session 变体

- **文件存在**: 是 (25 行)
- **死代码**:
  - `| { type: "session"; sessionID: string }` (行 5): 该 Route 变体从未被导航到。代码库中没有 `navigate({ type: "session", sessionID: ... })` 的调用，也没有匹配 `route.data().type === "session"` 的逻辑。
- **删除安全性**: **安全**。这是从未使用的预留变体。删除后 `Route` 类型简化为 `{ type: "home" }`。

## 5. `packages/tui/component/message-list.tsx` — `_MAX_VISIBLE_TOOLS` 常量

- **文件存在**: 是 (358 行)
- **死代码**:
  - `const _MAX_VISIBLE_TOOLS = 3` (行 12): 声明后**从未被读取或使用**。
- **删除安全性**: **安全**。纯未使用常量，下划线前缀暗示曾计划使用但最终未用。

## 6. `packages/tui/util/clipboard.ts` — `copy` 别名导出

- **文件存在**: 是 (55 行)
- **死代码**:
  - `export const copy = copyToClipboard` (行 10): 别名导出**从未被任何文件引用**。所有消费者都直接 import `copyToClipboard`（如 `selection.ts` 行 1、`prompt/index.tsx` 行 7）。
  - `_reject` 参数 (行 36): `readFromClipboard` 中的 `_reject` 参数是未使用的参数，下划线前缀表示已知未使用。
- **删除安全性**:
  - `copy` 别名: **安全**。无消费者。
  - `_reject` 参数: **安全但属于惯例**。Promise 构造函数签名 `(resolve, reject)` 中 `reject` 是第二个参数，这里改为 `_reject` 表示有意不用，删除会破坏函数签名。**不建议删除**。

## 7. `packages/core/session-compactor.ts` — `_latestVersion` 变量

- **文件存在**: 是 (532 行)
- **死代码**:
  - `let _latestVersion = 0` (行 180): 声明后在行 185 被赋值 `_latestVersion = v`，但**从未被读取或返回**。这个变量仅记录了最新版本号但从未使用。循环中真正需要的是 `latestPath`（行 181）。
- **删除安全性**: **安全**。删除 `let _latestVersion = 0` 和 `_latestVersion = v` 赋值后，逻辑完全不变。`latestPath` 仍然在行 186 被正确设置。

## 8. `packages/core/loop.ts` — `_duration` 变量

- **文件存在**: 是 (411 行)
- **死代码**:
  - `const _duration = Date.now() - startTime` (行 278): 计算了会话持续时间但**从未被使用**。注释说"记录会话结束"，但实际上没有记录到任何地方。性能追踪已由 `timer.buildTrace()` 在行 281 处理。
- **删除安全性**: **安全**。纯未使用的计算。注意：`startTime`（行 178）在删除 `_duration` 后仍然被 `timer.buildTrace()` 间接使用（通过 Timer），但实际 `startTime` 本身在删除 `_duration` 后也不会被使用了。需确认 `startTime` 是否还有其他用途——在 `run()` 方法中，`startTime` 仅在行 178 和 278 出现。删除 `_duration` 后 `startTime` 也变成死代码，可以一并删除。

## 9. `packages/llm/cost.ts` — calculateCost 和 formatCost

- **文件存在**: 是 (37 行)
- **死代码**:
  - `calculateCost()` 函数 (行 28-31): **无任何消费者**。在全代码库中搜索 `calculateCost` 仅在自身定义处和 `code-quality-improvement-plan.md` 中出现。
  - `formatCost()` 函数 (行 33-37): **有消费者**！在 `status-bar.tsx` 行 2 和 23 被导入和使用，在 `llm/index.ts` 行 3 被 re-export。**不是死代码**。
  - `CostEstimate` 接口 (行 4-11): 仅被 `estimateCost` 和 `calculateCost` 的返回值使用。`estimateCost` 有消费者（status-bar.tsx），所以该接口**不是死代码**。
- **删除安全性**:
  - `calculateCost`: **安全删除**。无消费者。
  - `formatCost`: **不安全删除**。`status-bar.tsx` 依赖它。`llm/index.ts` 的 re-export 也需保留。

---

## 汇总

| # | 文件 | 死代码 | 安全删除 |
|---|---|---|---|
| 1 | `packages/tui/context/keybind.tsx` | 整个文件（无消费者） | **是** |
| 2 | `packages/tui/ui/dialog.tsx` | 整个文件（无消费者） | **是** |
| 3 | `packages/tui/app.tsx` | KeybindProvider/DialogProvider 包裹 + import | **是**（需与 #1 #2 同步） |
| 4 | `packages/tui/context/route.tsx` | `session` Route 变体 (行 5) | **是** |
| 5 | `packages/tui/component/message-list.tsx` | `_MAX_VISIBLE_TOOLS` (行 12) | **是** |
| 6 | `packages/tui/util/clipboard.ts` | `copy` 别名 (行 10) | **是** |
| 7 | `packages/core/session-compactor.ts` | `_latestVersion` (行 180, 185) | **是** |
| 8 | `packages/core/loop.ts` | `_duration` (行 278) + 可能的 `startTime` (行 178) | **是** |
| 9 | `packages/llm/cost.ts` | `calculateCost()` (行 28-31) 仅此函数 | **是**（`formatCost` 有消费者，不删） |
