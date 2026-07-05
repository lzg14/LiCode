# Subagent Actor Model — L3 完整 mimocode 对齐

**目标**：把 licode 的 SubagentManager 重构为 mimocode 的 actor 模型，让 TUI 能：
1. 底部状态栏显示 subagent 状态 + token/cost
2. 弹窗显示完整 subagent 列表
3. Main / Prev / Next 按钮在父/子 agent 视图间切换

**日期**：2026-07-05
**状态**：待审批（建议先做 L1+L2 验证需求，再上 L3）

---

## 1. 现状盘点

### 1.1 licode 现状

| 文件 | 状态 |
|---|---|
| `packages/core/subagent.ts`（278 行）| `SubagentManager` + `spawn/runMultiple` + `getRunningCount/getQueueLength` |
| `packages/core/__tests__/subagent-tool-result-schema.test.ts`（173 行）| 2/2 通过，验证 type 字段 |
| `packages/core/__tests__/subagent.test.ts` | 4/4 通过 |
| `packages/core/phases/execute/main.ts` | subagent 工具：LLM 调 `subagentManager.spawn` 派子 agent |
| `packages/tui/component/message-list.tsx` | 渲染 subagent 派出的 tool 消息（**没有专门的 subagent UI**）|
| `packages/tui/` | ❌ **完全没有 subagent 状态展示** |

### 1.2 mimocode 完整设计

`MiMo-Code/packages/opencode/src/actor/` 目录结构：

```
actor/
├── actor.sql.ts        39 行  Drizzle schema (22 字段)
├── registry.ts        412 行  Effect-based CRUD (register / updateStatus / list)
├── spawn.ts           741 行  spawn 逻辑 (创建 actor + 启动 LLM 循环)
├── waiter.ts                    等待 actor 完成的 API
└── (其他辅助)
```

`actor.sql.ts:13-29` SQLite actor 表关键字段：

```sql
actor_id           text NOT NULL  -- 主键 (session_id, actor_id)
parent_actor_id    text          -- 父子关系
mode               text          -- 'peer' | 'subagent' | 'main'
status             text          -- 'pending' | 'running' | 'idle'
last_outcome       text          -- 'success' | 'failure' | 'cancelled'
lifecycle          text          -- 'ephemeral' | 'persistent'
agent              text          -- agent 名字
description        text          -- task 描述
context_mode       text          -- 'none' | 'state' | 'full'
context_watermark  text          -- 消息 ID
background         boolean       -- 是否后台运行
tools              json          -- 工具白名单
last_turn_time     int
turn_count         int
last_error         text
time_completed     int
time_created/updated
```

`subagent-footer.tsx:14-21`（底部状态栏）：

```typescript
const actors = createMemo(() =>
  (sync.data.actor[route.sessionID] ?? [])
    .filter((a) => a.mode === "subagent")
    .toSorted((a, b) => a.time_created - b.time_created),
)
```

`dialog-subagent.tsx:10-14`（弹窗列表）：

```typescript
const actors = createMemo(() =>
  (sync.data.actor[props.sessionID] ?? [])
    .filter((a) => a.mode === "subagent" || a.mode === "peer")
    .toSorted((a, b) => a.time_created - b.time_created),
)
```

**关键设计**：
- actor 持久化到 SQLite（重启后能看到历史 subagent）
- `sync.data.actor[sessionID]` 是 sync store 维护的 actor 列表
- Main/Prev/Next 命令触发 `session.parent` / `session.child.previous` / `session.child.next` 切换 `route.agentID`
- 每个 actor 独立视图（agentID）

---

## 2. 工作量评估

| 模块 | 工作量 | 备注 |
|---|---|---|
| **核心层** |||
| `actor.sql.ts` Drizzle schema（22 字段）| 0.5 天 | 新建 SQLite 表 |
| `actor/registry.ts` CRUD（register / updateStatus / list / get）| 1 天 | Effect-based（mimocode 412 行） |
| `actor/spawn.ts` spawn 逻辑 | 1.5 天 | 现有 subagent.ts 重构（278 → 700+ 行） |
| `actor/waiter.ts` 等待 API | 0.5 天 | |
| `core/execute/main.ts` subagent 工具 schema 改造（加 actor_id 输出）| 0.5 天 | |
| **TUI 层** |||
| `component/subagent-footer.tsx` | 0.5 天 | 照搬 mimocode 142 行 |
| `routes/session/dialog-subagent.tsx` | 0.5 天 | 照搬 47 行 |
| Main/Prev/Next 命令 + 路由 agentID | 0.5 天 | |
| sync store 集成（actor → sync.data.actor）| 0.5 天 | |
| **session 持久化** |||
| actor 状态变更写回 SQLite | 0.5 天 | |
| 重启后恢复 actor 列表 | 0.3 天 | |
| **测试 + 调试** |||
| registry / spawn 单元测试 | 0.5 天 | |
| 集成测试 + TUI 调试 | 0.5 天 | |
| **总计** | **7-9 天** | 单 agent 串行 |

---

## 3. ⚠️ 强烈建议：先 L1+L2 验证需求

**L3 完整对齐 mimocode 是 7-9 天工程**——但 **mimocode 本身是 1153 行的 actor/ 目录 + 复杂 Drizzle schema**，直接照搬对 licode 收益有限：

1. **licode 的 subagent 用法简单**：只是 `subagent` 工具（一个 tool），不像 mimocode 把 subagent 提升为"一等公民 actor"
2. **L3 的"Main/Prev/Next 切换视图"价值有限**：licode 用户的核心痛点是"看不到 subagent 在跑 + 看不到结果"，**不需要切换视图**（用户只关心主 agent + 当前活跃 subagent）
3. **actor model 重写风险高**：现有 subagent.ts 测试覆盖不足，重写可能引入新 bug

### 3.1 推荐替代：L1 + L2（**2-3 小时**）

| 级别 | 内容 | 工作量 | 用户价值 |
|---|---|---|---|
| **L1** | 底部 status bar 加 `🧠 N subagent running` | 0.5 小时 | 知道 subagent 在跑 |
| **L2** | 点开看子 agent 列表（task 摘要 + 状态）| 2 小时 | 知道每个在做什么 |
| **合计** | | **2.5 小时** | 解决核心痛点 |

**L1+L2 实现路径**：
- 用 `createSignal` 在 `loop.tsx` 维护 `subagentStatuses: Array<{task, status, startTime}>`
- `subagentManager.spawn` 包装一层，调用时 push status，结束时 update
- `useEffect` 轮询（500ms 间隔）把 status 数组同步到 TUI

### 3.2 如果坚持 L3

先确认 3 件事再开工：

1. **actor model 是 mimocode 核心架构**——licode 是否要全盘采用？
2. **route.agentID 切换**：licode 现在 route 只有 `sessionID`，加 `agentID` 影响所有 routes（home/settings/help）
3. **SQLite 持久化**：licode 现在 session 持久化但 **subagent 不持久化**（每次启动 subagent 列表空）—— actor model 必须持久化吗？

---

## 4. L3 实施步骤（如果走）

### Step 1: 数据层（1 天）
- `packages/core/actor/actor.sql.ts` — Drizzle schema
- 加 `actor_registry` 表到 licode 现有 schema
- verify: `bunx tsc` + `bun test packages/session`

### Step 2: registry CRUD（1 天）
- `packages/core/actor/registry.ts` — register / updateStatus / list / get / listByParent
- 用 createSignal 暴露给 useLoop（替代 sync store）
- verify: 单元测试

### Step 3: spawn 重构（1.5 天）
- `packages/core/actor/spawn.ts` — 基于 subagent.ts 改造
- spawn 时 register actor（status=pending → running → idle）
- 完成时 updateStatus（status=idle, last_outcome=success/failure）
- 错误时记录 last_error
- verify: 现有 subagent.test.ts + subagent-tool-result-schema.test.ts 全过

### Step 4: execute.ts 集成（0.5 天）
- `subagent` 工具 schema 加 `actor_id` 输出
- LLM 调 subagent 工具后能看到 actor_id，能 `actor.wait(actor_id)` 等结果
- verify: execute-e2e 测试

### Step 5: 持久化（0.5 天）
- 每次 actor 状态变更写 SQLite
- 重启后从 SQLite 加载
- verify: 单元测试

### Step 6: TUI footer（0.5 天）
- `packages/tui/component/subagent-footer.tsx` — 照搬 mimocode
- 集成到 home.tsx 底部
- verify: tsc + 手动跑 TUI

### Step 7: dialog 弹窗（0.5 天）
- `packages/tui/routes/session/dialog-subagent.tsx` — 照搬 mimocode
- 集成到 home.tsx 命令菜单
- verify: tsc

### Step 8: Main/Prev/Next 切换（0.5 天）
- keybind 加 `session.parent` / `session.child.previous` / `session.child.next`
- route 加 `agentID` 字段
- 验证: tsc + 手动跑

### Step 9: 集成测试（0.5 天）
- 写 E2E：派 subagent → 看到 footer 状态 → dialog 列表
- verify: bun test 全过

### Step 10: 文档 + commit（0.5 天）
- CHANGELOG：Unreleased Added + Changed 分类
- 计划文档归档

**总时间：7-9 天（串行）**

---

## 5. 不做什么

- ❌ 不实现 Effect（用 SolidJS signal + promise 替代）
- ❌ 不实现"peer mode"（mimocode 支持 sub-sessions，licode 暂不需要）
- ❌ 不实现 `actor.wait()` 异步等待（mimocode 有，licode 暂不需要——subagent 是同步工具）
- ❌ 不实现 actor context_mode 复杂模式（none / state / full）—— licode 简化为 subagent 自己 context
- ❌ 不动 mimocode 源码（直接照搬设计思想 + 简化实现）

---

## 6. 待审批

**强烈建议**：先做 **L1+L2（2.5 小时）** 验证用户需求，再决定是否 L3。

如果你坚持 L3，请确认：
1. ✅ 接受 7-9 天工作量
2. ✅ route 加 agentID 字段（影响所有 routes）
3. ✅ actor 持久化到 SQLite

如果你选 L1+L2，请告诉我，我立即开工。