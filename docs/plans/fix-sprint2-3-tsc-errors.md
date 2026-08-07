# licode Sprint 2/3 修复清单（审查发现）

**目标**：修复 pi-inspired 改进计划实施后 tsc 未归零、测试未全绿的问题。本文只列"待修复"，不含已完成验证的部分。

**日期**：2026-08-07
**依据**：审查实测 — `bunx tsc --noEmit --skipLibCheck` 报 **37 处错误**，`bun test` **1326 pass / 12 fail / 2 errors**。文档勾选验收与实测不符。

---

## 验收基线（修复达成）

- `bunx tsc --noEmit --skipLibCheck` → **0 error**（必须归零，含非本计划的历史残留）
- `bun test` → 0 error / 0 fail（flaky 除外：cli index、elevated_bash timeout）
- 修复后同步计划文档 `docs/plans/pi-inspired-improvements-plan.md` 的验收勾选状态

---

## 一、本计划引入的错误（优先级：先修这些）

### 1. Sprint 2 — `packages/core/phases/execute/run-loop.ts`（6 处）

| 行 | 错误 | 修复方向 |
|---|---|---|
| 107 | `maxSteps` 不存在于 ai SDK CallSettings | 移除 `maxSteps`，改用既有 `MAX_ITERATIONS` 循环或合法参数 |
| 127 | `TypedToolCall[]` 不能赋给 `DynamicToolCall[]` | 显式转 `as DynamicToolCall[]`（与 `main.ts` 一致）|
| 168 | `mimeType` 不存在于 `ImagePart` | 查 ai SDK v6 `ImagePart` 字段名（可能改 `mediaType` 已存在，`mimeType` 是冗余/错的；对照 `main.ts` 里的正确写法）|
| 241 | `SubagentManager` 没有 `execute` | 对照 `main.ts` 的 subagent 分支（`subagentManager.spawn(...)`），run-loop 用了错误的 API 名 |
| 299 | `RunLoopContext` 不兼容 `ExecuteContext`，`skillStack` 缺 `activatedAt` | `run-loop.ts:25 SkillStackItem` 类型应是 `packages/skills/stack.ts` 的 `SkillStackItem`（含 `activatedAt`），别手写瘦身版 |
| 385 | `cwd` 不存在于 `ToolExecutionOptions` | `globalToolRegistry.execute` 第 3 参是 `{ cwd }`，传 `{ cwd: ctx.cwd }` 而不是塞进 ToolExecutionOptions |

### 2. Sprint 2 — **破坏导出**（连带 4 处测试错 + 1 个 Unhandled）

`packages/core/phases/execute/index.ts` 现在只导出 `execute/runAgentLoop/RunLoopContext/PersistenceCallbacks`，**丢了 `findValidStart` 和 `loadProjectConfig`**。

- 报错文件：`__tests__/execute-helpers.test.ts:2`（含 `findValidStart, loadProjectConfig`）、`execute-e2e.test.ts:5`（`ExecuteContext`）、`execute-stream-error.test.ts:5`
- 修：把 `findValidStart`（来自 `helpers.ts`）和 `loadProjectConfig`（来自 `load-config.ts`）加回 `execute/index.ts` 导出；确认 `ExecuteContext` 也照旧导出。
- 同时删 `dist/` 里引用的旧 `loop.jsx`（见 §五）。

### 3. Sprint 3 — loop 拆分各 context（14 处）

`loop-scheduler.tsx:20,27,31,36,41,46` — 用了 `Scheduler` 上**不存在**的 `add/stopAll/stop`，且类型不匹配：
- 先读 `packages/core/scheduler.ts` 的真实 API（旧 `loop.tsx:858-895` 用的是 `scheduler.create(ms, prompt)` / `scheduler.deleteAll()` / `scheduler.list()`）。
- 拆出来的 scheduler context 必须调真实类方法，别沿用旧调用签名。若原本拆的调用不在 `Scheduler` 类上，可能是把别的对象的方法名照抄了——以 `scheduler.ts` 源码为准。

`loop-model.tsx`(3)、`loop-stream.tsx`(3)、`loop-skill.tsx`(2) — 同属"拆搬后类型对不上"，逐个对照旧 loop.tsx 原调用签名修。

### 4. Sprint 1 — `packages/core/utils/truncate.ts:219`（1 处）

`TruncateOptions` 缺 `maxLineLength` 字段 → 要么在 options 类型里补 `maxLineLength?: number`（若逻辑确实需要截行长），要么改调用处去掉该 prop，视 219 行意图。

### 5. Sprint 4.1 — `packages/session/query-builder.ts:433`（1 处）

`unknown` 不能传参给 `Record<string, unknown>`，看 433 行附近 `archived` 标记/`archiveOldMessages` 加的代码，把 `unknown` 收窄/断言。

---

## 二、非本计划的历史残留（同样必须归零）

这些来自更早提交（`cb8701b` `d233cc8` 主题/扩展/多运行模式），但 tsc 0 error 必须把它们也消掉：

| 文件 | 错误 |
|---|---|
| `packages/sdk/index.ts` | 8 处 — 复用 `maxSteps`/`args`/`result`/`promptTokens`/`completionTokens` 同 §1.keys 的错误 API 名 |
| `packages/cli/modes/json.ts` | 5 处 — 同上类：`maxSteps`、ToolCall `args`、ToolResult `result`、`promptTokens`/`completionTokens` |
| `packages/tui/theme/loader.ts` | 3 处 — onResize 监听器重载、`eventType` 隐式 any、`iterator.close` 不存在 |
| `packages/extension/manager.ts` | 2 处 — `window.removeExtension` 不存在、`ToolDefinition` 不兼容 `RegisteredTool` |

> 这几个多为"调用了不存在的 API 名"，多半是异构/换库后没跟；对照各自所属模块的类型声明改。

---

## 三、测试：12 fail / 2 errors 的处理

| 分组 | 现状 | 该不该修 |
|---|---|---|
| Intelligence 2 fail | 全量 fail 但 `bun test packages/core/intelligence` 单跑 52/0 ✅ | **Sprint 0 已修对**；全量下是**测试隔离/顺序污染**（写真实 `~/.licode/memory`）。修法：测试显式 local tmp + 关闭 resource 共享（不在本单修范围，标记即可） |
| cli index 3 fail | flaky（单跑过） | 另案，本期可不修 |
| elevated_bash timeout 2 fail | flaky（用时 ~4.9s） | 另案，本期可不修 |
| Unhandled:`loadProjectConfig` not found | **Sprint 2 破坏** | 修 §一.2 即解决 |
| Unhandled:`partsToString` not found in `dist/tui/context/loop.jsx` | 引用了 dist 旧产物 | **清理 `dist/`**：删掉 `dist/` 旧编译物，重 build（`bun run build`）确保拆分的 loop 无 `partsToString` 明靠；检查是否有测试/模块 import `dist/` |

---

## 四、完成定义（DOD）

修完需所有 satisfy：
- [ ] `bunx tsc --noEmit --skipLibCheck` → 0 error
- [ ] `bun test` → 0 error / 0 fail（flaky 组单跑验证，运行时间可超）
- [ ] 更新 `docs/plans/pi-inspired-improvements-plan.md` 验收勾选（与实测一致，别先勾）
- [ ] 更新 `CHANGELOG.md` `## [Unreleased]`（计划还没来得及加）

---

## 五、关键参考

- 既有计划：`docs/plans/pi-inspired-improvements-plan.md`（Sprint 0-4）
- 原型未坏版本（Sprint 2 重构前）：`git show 0345ce6^:packages/core/phases/execute/main.ts`；`git show 0345ce6^:packages/core/phases/execute/helpers.ts`；`git show 0345ce6^:packages/core/phases/execute/load-config.ts`；`git show 0345ce6^:packages/core/phases/execute/index.ts`
- 非本计划多模式：`packages/sdk/`、`packages/cli/modes/`、`packages/extension/`、`packages/tui/theme/`（来源 commit `cb8701b` / `d233cc8`）