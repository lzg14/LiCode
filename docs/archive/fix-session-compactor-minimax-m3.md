# Session Compactor 对未注册模型（MiniMax-M3）失效：修复指南

> **⚠️ OBSOLETE — 已被 commit `eef4725` 完整覆盖**
>
> 修复合入：`eef4725 fix(core|tui|llm): SessionCompactor 失效根因修复`
>
> 改动文件（按 commit 统计）：
> - `packages/core/session-compactor.ts` (+11) — fallback 阈值
> - `packages/core/loop.ts` (+8) — `getModelConfig` 兜底
> - `packages/llm/provider.ts` (+57) — normalize 副作用（§2.1 真根因）
> - `packages/tui/component/sidebar.tsx` (+13) — UI 联动
> - `packages/tui/context/loop.tsx` (+23) — `contextToken` 更新
> - 新增 2 个测试文件：`session-compactor-fallback.test.ts`、`resolve-context-window.test.ts`
>
> **本文档诊断自纠**（基于其他 agent 的 commit `eef4725` 实施与本次会话的事实回顾）：
> - §2.1 normalize 副作用 / catalog 错位 — ✅ 真根因，已修复
> - §2.2 "compactor 永远不触发" — ❌ 错。compactor 一直在跑；真实问题是**频率参数周期短 + 用户感知不到**（见 `silent-failures.md` c 条目 + 后续 commit `44c90d4` 升级）
> - §2.3 silent-fail — ✅ 仍对；已被 `44c90d4` 升级到 `warn` + UI 联动
>
> **关联 commit 链**（同一时间窗内系统性修复 silent failure 主题）：
> - `eef4725` SessionCompactor 根因修复
> - `44c90d4` silent-failures.md d 条目扩展（"LLM 假装收口"）
> - `9222d9b` streamText 解析失败吞 tool-call 修复
> - `f75cc7c` 消息显示闪烁修复
>
> 本文档保留作为**诊断历史参考**。
>
> ---
>
> 承接会话 `D:\ProjectFile\licode` 在 102K/128K(80%) 时未触发压缩的诊断结论。
> **建议在新会话中执行本修复**，原会话因上下文接近 95% 红线再次叠加写入成本可能强制截断。

## 1. 问题描述

`packages/tui/component/sidebar.tsx` 状态栏显示 `102.0K / 128K (80%)`（黄色警示），但 `SessionCompactor` 始终未触发压缩。持续上涨直到 95% 红线甚至模型硬上限，可能直接导致 LLM 调用失败或响应截断。

## 2. 根因（三处不匹配）

### 2.1 contextWindow 来源断裂

文件：`packages/core/loop.ts`（`sessionCompactor` 调用点，line 594 附近）

```ts
const contextWindow = getModelConfig(this.config.llm.model)?.contextWindow
if (this.sessionCompactor.shouldCompact(history, ctx.sessionId, contextWindow)) {
  ...
}
```

`MiniMax-M3` 在工程 model registry 中**很可能未注册**（工程内模型 ID 命名与 Minimaxi 不一致是常见问题），导致 `getModelConfig(...).contextWindow` 返回 `undefined`，沿可选链一路穿透。

### 2.2 fallback 阈值过大

文件：`packages/core/session-compactor.ts` `shouldCompact()`

```ts
const tokenThreshold = contextWindow
  ? Math.floor(contextWindow * 0.8)
  : this.config.maxTokens   // DEFAULT_MAX_TOKENS = 200_000
```

无 `contextWindow` 时阈值退化到 **20 万 tokens** —— 而绝大多数现代模型（GPT-4 / Claude / 等）真实 `contextWindow` ≤ 200K，本地粗估永远达不到，所以**永远触发不了**。

### 2.3 UI 警示与压缩器口径不同 + 失败被吞

- **状态栏口径**：`contextTokens()` ≈ LLM API 最近返回的 `input_tokens`（精确），`maxContext` 来自 `modelInfo().contextWindow ?? 128000`
- **压缩器口径**：`estimateTokens()` 用 `字符数 / 4` 的本地粗估（与 API 返回值可能差 2-5 倍）
- **失败被吞**：见 `docs/silent-failures.md` c 条目 —— `sessionCompactor.compact()` 的 `.catch(e => devLogger.debug(...))` 让后台失败只落 debug 日志，UI 完全不知情

## 3. 受影响文件清单

| 文件 | 大致行 | 修改类型 |
|---|---|---|
| `packages/core/session-compactor.ts` | `DEFAULT_CONFIG` & `shouldCompact()` | 收紧 fallback 阈值（A 方案） |
| `packages/core/session-compactor.ts` | `DEFAULT_CONFIG` | 新增 `unknownModelThreshold` 字段 |
| `packages/core/loop.ts` | 调用 `getModelConfig(...).contextWindow` 处 | 显式兜底或加 log |
| model registry 文件（待定位） | 新增条目 | 注册 MiniMax-M3（B 方案） |
| `packages/tui/component/sidebar.tsx` | line 31-32 | UI 与压缩状态联动（C 方案） |

## 4. 推荐修复方案

### 方案 A：收紧 fallback 阈值（最小改动，1 行级，**推荐先做**）

修改 `packages/core/session-compactor.ts`：

```ts
const DEFAULT_CONFIG = {
  maxMessages: 200,
  maxTokens: 200_000,
  unknownModelThreshold: 100_000,   // 新增：contextWindow 缺失时使用
  debounceMs: 600_000,
}
```

`shouldCompact()`：

```ts
const tokenThreshold = contextWindow
  ? Math.floor(contextWindow * 0.8)
  : Math.min(this.config.maxTokens, this.config.unknownModelThreshold)
```

**效果**：未知模型也能保证在 10 万 tokens 本地估算内触发压缩，回退路径与 fallback 200K 完全解耦。

### 方案 B：注册 MiniMax-M3 到 model registry（结构修复）

定位工程 model registry 文件（搜索关键字 `MiniMax-M3 / minimax / MiniMax`，注意工程可能叫 Minimaxi 而非 MiniMax），新增：

```ts
{
  id: 'MiniMax-M3',
  displayName: 'MiniMax M3',
  contextWindow: 128000,
  // 其他必填字段
}
```

**效果**：根除方案 A 处理的 fallback 退化路径。同时建议**为 minimaxi 系列所有变体注册占位项**（避免下次换个 variant 又踩坑）。

### 方案 C：UI 与压缩器状态联动（体验修复）

`packages/tui/component/sidebar.tsx` line 31-32 当前的硬编码警示：

```ts
if (contextUsage() > 95) return error()
if (contextUsage() > 80) return warning()
```

应改为**订阅** `sessionCompactor.lastCompactionAt` 或独立 signal —— 当压缩刚刚跑过，临时降级警示；当压缩静默失败超过 N 毫秒，升级提示用户。

## 5. 测试建议

1. **mock 测试**：mock LLM 报告 `input_tokens = 130000`（> 80%），用 `MiniMax-M3` 跑 ~50 条消息，应在 `debounceMs`（10 min）后看到压缩日志 + UI 状态变化
2. **fallback 单元测试**：直接 `shouldCompact(history, sessionId, undefined)`，断言走的是 `unknownModelThreshold` 路径
3. **回归测试**：用已注册模型（如 minimaxi-M2、`gpt-4`）跑同样场景，确保原阈值路径不变
4. **silent-failure 测试**（方案 C 配套）：故意让压缩抛错，验证 UI 能看到错误而非静默

## 6. 后续需确认

新会话中需要先确认以下事实，再选定具体行号：

- `getModelConfig` 实现位置与 fallback 行为
- model registry 文件路径与 minimaxi 系列 ID 命名约定
- `onLLMResult` 回调如何更新 `contextTokens` signal
- `SessionCompactor.config.maxTokens` 是用户可配还是 hard-coded

## 7. 关联文档

- `docs/silent-failures.md` —— c 条目记述本会话命中的同类陷阱
- `docs/text-encoding-pitfalls.md` —— L01 PowerShell ANSI 解码误报（同会话已读，无直接关联）
- 系统提示词：`Your model version is MiniMax-M3, developed by MiniMax. Knowledge cutoff: January 2026.`

## 8. 不要做的事

- ❌ **不要在本会话继续改源码** —— 上下文已 80%，再叠加 `read/edit/run_tests` 循环大概率撞 95% 红线
- ❌ **不要改 `truncate.ts`** —— 它只负责单工具输出截断，与 session 级压缩完全无关
- ❌ **不要只改 UI 警示阈值** —— 那是治标，根因在 compactor fallback
- ✅ **新会话第一件事**：load 本文档，按 §4 方案 A → B → C 顺序推进
