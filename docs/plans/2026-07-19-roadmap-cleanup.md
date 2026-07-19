# licode 后审视 Roadmap（2026-07-19）

**目标**：整合 2026-07-19 架构审视发现的所有改进项，给出明确的下一步优先级；同时清理本次会话残留的工作区混乱状态。

**日期**：2026-07-19（最后更新：2026-07-19 11:30）

**相关文档**：
- [`docs/architecture/2026-07-19-licode-architecture-review.md`](../architecture/2026-07-19-licode-architecture-review.md) — 本次会话的审视报告（11 项改进建议的来源）
- [`docs/plans/production-gaps-2026-q3.md`](production-gaps-2026-q3.md) — v0.2.0 → v0.4.1 的生产可用性差距评估（本计划**不**涵盖，见"不做什么"段）

**依据**：
- 本次会话实际执行的 11 个 commit
- master 现状 + 工作区 + 分支残留检查
- 并行 agent 完成的工作（markdown cache + thinking view）

**范围**：状态清理 4 步 + 待办改进 9 项（5 重构 + 4 bug，约 11-21 小时集中开发）

---

## 背景：本次会话做了什么

### 已合并到 master（fast-forward，无冲突）

**第一轮：8 个审视相关 commit**（与审视报告一一对应）

| Commit | 作者 | 类型 | 描述 |
|---|---|---|---|
| `9f0b19b` | Claude (本次) | fix(security) | env_vars 单 key 模式拒绝读敏感变量（防凭据泄露） |
| `863f87a` | Claude (本次) | fix(core) | scheduler tick() await 后检查 task，防 zombie timer 泄漏 |
| `ef99bb3` | Claude (本次) | fix(tui) | SIGINT handler 改用 installSigintAbort() 追加+dispose |
| `5090e5a` | Claude (本次) | refactor | 6 处 ID 统一用 crypto.randomUUID() |
| `dd86e5e` | Claude (本次) | fix(core) | compaction trimAfter 加 try/catch + race 注释 |
| `0c22585` | Claude (本次) | chore(deps) | 显式声明 @ai-sdk/provider-utils（修 knip unlisted warning） |
| `7b03ad3` | Claude (本次) | refactor(core) | shouldCompact 拆成 3 个纯函数（CCN 29→4） |
| `3abf2cc` | Claude (本次) | chore | 删 packages/eval/ + skills/self-improve.ts（~470 行死代码） |

**第二轮：并行 agent 完成 TUI markdown cache + thinking view**

| Commit | 作者 | 类型 | 描述 |
|---|---|---|---|
| `d29744d` | lizhgb (并行) | feat(tui) | add markdown token cache + StaticMarkdown component（341 行 + 88 行测试）|
| `4d5e2fe` | lizhgb (并行) | feat(tui) | render thinking content + stop streaming markdown re-parse |

**第三轮：3 个后续 bug 修复**（发现静态 markdown 渲染 bug 链式引出）

| Commit | 作者 | 类型 | 描述 |
|---|---|---|---|
| `cdabcf2` | Claude (本次) | fix(tui) | static-markdown 删 `const S = "span"` hack，改用 OpenTUI 原生 `<text>` |
| `c141d7c` | Claude (本次) | fix(tui) | static-markdown 把 inline tokens 拍平成字符串（修 "TextNodeRenderable only accepts strings"）|
| `8b5025e` | Claude (本次) | feat(tui) | ErrorBoundary fallback 改用 devLogger.logException，渲染错误带完整 stack |

CHANGELOG `[Unreleased]` 已同步更新（覆盖第一轮 + 第二轮，第三轮未追加）。`bunx tsc --noEmit --skipLibCheck` 通过；本次会话我改过的所有包测试 161+4=165/165 pass。

**master 状态**：截至 2026-07-19 11:30，master 领先 origin/master **33 commits**，构成如下：

| 数量 | 来源 |
|---:|---|
| 16 | 本次会话开始前，master 已经领先 origin/master 的部分（含别的会话/agent 的历史工作） |
| 8 | 本次会话由我提交的 commit（本次会话期间派发的 subagent 工作） |
| 2 | 本次会话期间并行 agent 提交的 commit（d29744d + 4d5e2fe，markdown cache + thinking view） |
| 4 | 本次会话期间其他来源的 commit（其他 agent/手动 commit） |
| 3 | 本次会话期间后续的 bug 修复 commit（cdabcf2 修 Comp is not a function、c141d7c 修 TextNodeRenderable、8b5025e ErrorBoundary 集成 devLogger） |

> 注：第 3、4 行不是单一时间点拍快照，而是整个会话期间累积；表格只是说明构成，不暗示严格时间顺序。

**无冲突合并**：并行 agent 的 commit 引用了**我加的** `installSigintAbort` 和 `Message.tokens` 字段，且补全了 `addMessage` 漏掉的 `ensureMessageTokens(msg)` 调用 —— 是互补而不是冲突。

---

## 当前工作区状态（更新于 2026-07-19 11:30）

**已完成清理**：
- ✅ 工作区干净（除了刚写的 `docs/plans/2026-07-19-roadmap-cleanup.md` 本文档）
- ✅ 0 个 stash 残留
- ✅ 2 个过时 fix 分支已删（`fix/p0-bun-whitelist-and-security-config`、`fix/p1-core-skills-memory-tui-llm`），它们的内容都已包含在 master
- ✅ WIP 文件已由并行 agent commit 进 master（markdown cache + thinking view）

**待用户决定**：
- ✅ `backup/master-before-secret-purge` 已删（2026-07-19 11:30 确认）
- ⚠️ 30 commits ahead **决定先不 push**（2026-07-19 11:30 用户决定）
- ⚠️ 下一步 Bug4-7 + Step 5-9 **让别的 agent 做**（2026-07-19 11:30 用户决定）

---

## 步骤

### 阶段一：状态清理（约 10 分钟）

- [x] **Step 1: 清理工作区 WIP 和旧 stash** — **已完成**（并行 agent 把 WIP commit 进 master，stash 自动清空）
- [x] **Step 2: 删过时分支**（2 个 fix 分支 + 1 个 backup 分支）— **已完成**
- [ ] **Step 3: 跟用户决定 push 策略** — ahead 33 commits，2026-07-19 11:30 用户决定先不 push
  - verify: 用户明确说 push 或不 push

### 阶段二：审视报告里跳过的 P2/P3（用户按优先级挑）

之前明确**不**做这些（保留供后续决定，**2026-07-19 11:30 决定让别的 agent 做**）：

- [ ] Step 5（让别的 agent）: P2 重构 — cli/logs.ts:main() 引入 commander 库
  - 当前 CCN=29，手写 arg 解析脆弱
  - 工作量：2 小时

- [ ] Step 6（让别的 agent）: P2 重构 — loadProjectConfig() 改策略模式
  - 当前 CCN=21，4 种格式探测堆在一个函数里
  - 工作量：4 小时

- [ ] Step 7（让别的 agent）: P2 重构 — MessageItem 拆组件
  - 当前 CCN=20，按消息类型拆 7 个 renderer
  - 工作量：6 小时（TUI 渲染层，影响面最大）

- [ ] Step 8（让别的 agent）: P3 清理 — 9 个 unused barrel exports index.ts
  - knip 报告 core/llm/session/skills/memory/integration/tools/tui 的 index.ts 都是 0 引用
  - 工作量：1 小时（先确认这些不是 CLI 入口）

- [ ] Step 9（让别的 agent）: P3 清理 — 21 个 unused exports + 20 个 unused types
  - knip 报告剩余 41 个，逐个看是死代码还是 API 预留
  - 工作量：1-2 小时

### 阶段三：本次新发现的真实 bug（4 个，2026-07-19 11:30 决定让别的 agent 做）

之前审视报告里没列出，本次深读代码确认：

#### 🚨 Bug4: MCP 工具 z.any() 透传（安全问题）

**位置**：`packages/tui/context/loop.tsx:199`

```ts
const inputSchema = await import("zod").then(z => z.z.any())
globalToolRegistry.register({
  name: toolName,
  inputSchema,  // ← z.any() 完全跳过校验
  handler: async (input: any) => { ... }
})
```

**问题**：所有 MCP 工具（`mcp__<server>__<tool>`）的 inputSchema 是 `z.any()`，导致 `globalToolRegistry.execute()` 里的 `tool.inputSchema.parse(input)` 完全无效。LLM 可以传任意 JSON 给 MCP 工具：路径检查 hook 只按工具名匹配，但 MCP 工具如果后端实现了 read/write/delete 行为，就能绕过。

**修复**：用 `json-schema-to-zod` 库把 MCP 的 JSON Schema 转成 zod schema。1-2 小时 + 测试。

#### ⚠️ Bug5: createModel 重试是死代码

**位置**：`packages/llm/provider.ts:91-110`

```ts
for (const provider of providers) {
  const maxRetries = 3
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const model = createModelForProvider(provider, { ...config, provider })  // ← 同步调用
      return { model, contextWindow: resolveContextWindow(config.model) }
    } catch (error) { ... }  // ← 永远不会捕获网络错误
```

**问题**：`createModelForProvider` 是**同步函数**（`createAnthropic(...)(model)`、`createOpenAI(...).chat(model)`），不抛网络错误 —— 只有参数错误才会抛。重试逻辑的 try/catch 永远抓不到 await 调用 LLM API 时发生的 401/429/500。

**修复**：把重试逻辑移到调用 LLM 的层（`execute/main.ts:callLLM`），重试的是 LLM 调用本身而非 SDK 创建。2-3 小时。

#### ⚠️ Bug6: SessionCompactor.lastCompactTime 内存泄漏

**位置**：`packages/core/session-compactor.ts:64`

```ts
private lastCompactTime = new Map<string, number>()  // ← 永远不清
```

**问题**：`Map` 记录每个 session 的上次压缩时间，但 `SessionManager.deleteSession()` 删除 session 时不会清理这个 key。TUI 长期使用 + 频繁创建/删除 session → Map 无限增长。

**修复**：要么 LRU 限大小（如保留最近 100 个 session），要么在 `SessionManager.deleteSession()` 时通过依赖注入回调清理。1 小时。

#### ⚠️ Bug7: MCP withConnection 是空壳

**位置**：`packages/integration/mcp.ts:198-203`

```ts
async withConnection<T>(fn: () => Promise<T>): Promise<T> {
  if (!this.enabled) {
    throw new Error('MCP not connected')
  }
  return fn()  // ← 只检查 enabled，没重连
}
```

**问题**：方法名是 `withConnection`（暗示自动连接），但只检查 enabled 标志就调 fn。如果 MCP 进程意外死掉，`enabled` 仍是 true 但 client 已断，`fn()` 调用会失败。

**修复**：检测 `fn()` 是否抛连接错误，尝试重连 + 重试一次。30 分钟。

### 阶段四：综合优先级（推荐先做）

按价值/工作量比排序：

| 优先级 | 项 | 工作量 | 价值 |
|---|---|---:|---|
| 🔴 P0 | Bug4 MCP z.any() 修复（安全） | 1-2h | 防止 MCP 工具被滥用 |
| 🟡 P1 | Bug5 createModel 重试是死代码 | 2-3h | 修复看似正常但实际无效的容错 |
| 🟡 P1 | Bug6 lastCompactTime 内存泄漏 | 1h | 长期使用稳定 |
| 🟢 P2 | Bug7 MCP withConnection 重连 | 0.5h | 鲁棒性 |
| 🟢 P2 | Step 5 cli/logs.ts commander | 2h | 重构 CCN 29 |
| 🟢 P3 | Step 8/9 unused exports 清理 | 2-3h | 死代码 |
| ⚪ 不建议 | Step 6/7 P2 大重构 | 4-6h | 工作量大，可单独排期 |

**下一步建议**：先做 Bug4（安全，影响所有 MCP 工具），再做 Bug5（死代码修复），最后 Bug6（内存泄漏）。

---

## 不做什么

- 不修复 master 上原本就 fail 的 6-8 个测试（cli/index、logs CLI、IntelligenceRecorder），跟本次会话无关
- 不重命名模块或改 import 顺序（容易引起大爆炸 diff）
- 不动 [`production-gaps-2026-q3.md`](production-gaps-2026-q3.md) 里列的 v0.2.0 → v0.4.1 升级工作（独立工作，参见文档顶部交叉链接）
- 不修复 `master-before-secret-purge` backup 分支指向的 v0.2.0 状态（已删，备份场景不再需要）

---

## 验证清单

**本次会话结束时已满足的项**（截至 2026-07-19 11:30）：

- [x] `git status --short` 显示干净
- [x] `git stash list` 显示干净
- [x] 时过分支已删（2 个 fix/* + 1 个 backup/*）
- [x] `git branch -v` 只剩 master
- [x] `bunx tsc --noEmit --skipLibCheck` 通过
- [x] CHANGELOG `[Unreleased]` 已同步本次会话所有 commit

**待用户在下次会话决定的项**：

- [ ] `git log origin/master..HEAD --oneline | wc -l` = 当前值（33）— 是否 push 由用户决定
- [ ] knip 报告的 unused 数显著减少（每个完成的 Step 4-12 对应减少数）
- [ ] master 上原本就 fail 的 6-8 个测试（cli/index、logs CLI、IntelligenceRecorder）是否修复（不在本计划范围）