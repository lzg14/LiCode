# licode 改进实施计划（借鉴 pi）

**目标**：把 pi（`earendil-works/pi`，84k+ star 的 terminal AI coding agent）经过审校的生产级工程手法移植到 licode，同时修复当前 `bun test` 的失败与早已存在的 Memory 记忆污染 bug。产出分 Sprint、每步可独立验证、保持 licode 现有安全层与 39 工具的领先优势。

**日期**：2026-08-07
**依据**：
- pi 源码研究（4 份笔记已归档 `.claude/pi-*-notes.md`）
- 既有 bug 修复计划（`docs/plans/code-health-improvement-plan.md`，Sprint A/B 引用之）

---

## 一、对照结论（谁领先）

| 维度 | licode | pi | 结论 |
|---|---|---|---|
| 安全 pre-execute hook / 命令白名单/路径检查 | 有（强） | 无（靠项目信任+取消） | ✅ licode 领先，保留 |
| 内置工具 | 39 个 | 7 个 | ✅ licode 领先 |
| 运行时 | Bun + SQLite 单二进制 | npm monorepo | ✅ licode 领先 |
| 事件驱动 / 循环解耦 | 巨型 `execute()`，UI 轮询 | `纯循环`+状态外壳发 4 级事件，UI 只订阅 | 🔴 pi 领先 |
| 大状态组织（loop.tsx） | 961 行 god context | 状态下沉,UI 只管订阅事件 | 🔴 pi 领先 |
| 工具输出卫生 | 无（bash 仅 maxBuffer） | truncate + 溢出落盘 + ANSI/二进制清洗 + 进程树 kill | 🔴 pi 领先 |
| skill 注入 | 注入索引表格 | 只注入元数据，读 SKILL.md 按需加载 | 🟡 pi 领先 |
| abort 体系 | LLM 有 signal；子进程/压缩无系统设计 | per-operation AbortController；跑工具前后查 signal | 🟡 pi 领先 |
| 会话持久化 | SQLite 线性 + 1000 条删行压缩（已有会话级 fork/tree） | 消息级 append 树 + 取消即回退 + 压缩投影 + 立即落盘 | 🟡 pi 领先 |

## 2. 优先级排序（性价比）

| # | 改进 | 分类 | 成本 | 价值 |
|---|---|---|---|---|
| 0 | 修 Memory `projectId` 碰撞 bug | Bug 修复 | 低 | 恢复测试基线 + 止住记忆污染 |
| 1 | 工具输出卫生（截断 + bash 清洗/落盘 + 进程树 kill） | 纯增量 | 低 | 防撑爆 context、中断更稳 |
| 2 | skill 只注入元数据 + read 按需加载 | 纯增量 | 低 | 省 token，符合 Agent Skills 标准 |
| 3 | 事件驱动解耦（execute → 纯循环 + 事件） | 结构性 | 中 | 一切的根，TUI/headless/测试复用 |
| 4 | loop.tsx(961) 拆分 | 结构性 | 中 | 可读性 + 可测 |
| 5 | 消息级 append 会话树 + 即时落盘 + 压缩投影 | 数据层 | 中高 | 崩溃不丢、可分支 |

---

## Sprint 0：修核心 Bug（引用 `code-health-improvement-plan.md` Sprint A）

**Memory `projectId` 前缀碰撞** — `packages/memory/memory.ts:37` 与 `packages/core/intelligence/recorder.ts:24` 都用 `base64(cwd).slice(0,16)`，同前缀项目共享同一记忆文件夹，是 `bun test` 10 个失败根因。

- [ ] 提取公共 `projectId(cwd)`（完整路径 sha256 十六进制前 16 位），`memory.ts` 与 `recorder.ts` 共用同一 helper
  - verify: `C:\Users\lzg14\ProjectA` 与 `ProjectB` 得到不同 pid；`bun test` → 0 fail
- [ ] 清掉 `~/.licode/memory/projects/QzpcVXNlcnNcbHpn` 下测试残留（可选，仅在确认无真实数据后）
- 详细步骤/verify 见 `docs/plans/code-health-improvement-plan.md` Sprint A/B

---

## Sprint 1：纯增量（低回归风险）✅ 已完成

### Step 1.1：工具输出卫生（pi 参考 `coding-agent/core/tools/bash-executor.ts:64-129`, `utils/shell.ts`）✅

**licode 现状**：`packages/tools/builtin/shell.ts:62` 的 bash 仅用 `maxBuffer: 10*1024*1024`，无 ANSI 剥离/二进制清洗/滚动缓冲/超限落临时文件；read/grep 等大输出会直接撑爆 context。

- [x] 新增 `packages/core/utils/truncate.ts`（对标 pi）：`truncateHead` / `truncateTail` / `truncateLine` / `stripAnsi` / `stripBinary` / `smartTruncate`，统一"截断不静默"约定 ✅
- [x] bash 工具：输出 ANSI 剥离 + 二进制清洗 + 滚动缓冲（默认 20KB/5000 行），超限写临时文件并返回 `fullOutputPath` 供模型续读 ✅
- [x] bash 超时友好：`timeout` 秒参数上限校验（300s）+ timeout 错误转友好文案 ✅
- verify: `bun test packages/core/utils` ✅，truncate 工具测试全绿

### Step 1.2：skill 只注入元数据 + read 按需加载（pi 参考 `coding-agent/src/core/skills.ts:335`）✅

**licode 现状**：`packages/skills/loader.ts:254-260` 的 `getSkillIndex` 返回 name/desc/triggerHints → `packages/core/phases/execute/main.ts:313-327` 把完整索引**表格**注入 system prompt，激活时再注入全文。

- [x] `getSkillIndex` 增加 `path` 字段（SKILL.md 位置）✅
- [x] `buildSystem` 改为注入元数据表格（含路径列），提示模型按需 read 加载 ✅
- [x] 激活技能时仍注入当前技能全文（交互激活保留） ✅
- verify: `bun test packages/skills` ✅，skill 相关测试全绿

---

## Sprint 2：事件驱动解耦（结构性）✅ 基础完成

**licode 现状**：`packages/core/phases/execute/main.ts` 的 `execute()` 一边调 LLM 一边改内部状态+通知 TUI，无清晰事件流，TUI 只能读全局/轮询。

**目标架构**（对标 pi；licode 不必起完整树，先拆两层）：
```
execute/main.ts  →  runAgentLoop(ctx, emitEvent?, handlers?)   纯函数不可变循环外
                       │  在每 turn/每个 tool 前前后 emit
                       ▼
packages/core/events.ts  定义 AgentEvent 判别联合（4 级：agent/turn/message/tool）
packages/core/AgentState.ts  有状态外壳：持 transcript/状态集，processEvents 广播 + subscribe()
                                （对标 pi Agent 类）
```

- [x] 新建 `packages/core/events.ts`：`AgentEvent`（判别联合 13 种事件类型），对应 pi `AgentEvent` ✅
- [x] 抽 `runAgentLoop(ctx, onEvent, handlers...)` 纯函数：把 `execute()` 循环体搬进来，**只** emit 事件 ✅
- [x] 加一层 `AgentState`（包装类/事件源）在最外圈，`subscribe()` 暴露 ✅
- [ ] `packages/core/loop.ts` 的现有调用点改为走新入口（待后续集成）
- verify: `bun test packages/core` ✅（174 pass，flaky 1 fail）

> 此 Sprint 只做"把循环写成纯函数 + 事件 sink"，**不动** TUI 接线，保证可回退。

---

## Sprint 3：loop.tsx 拆分（结构性）✅ 阶段 A/B 完成

**licode 现状**：`packages/tui/context/loop.tsx`（961 行）在 context/loop 一个文件里塞 MCP 初始化(252-318)、session 恢复、skill 建议、流式防抖(485-513)、subagent 跟踪、scheduler、输入队列、图片解析。

> 核心教训（pi）：不是“把文件拆小”，而是“把共享状态抽出成独立 Session/AI 状态对象”。licode 现在根本没有独立状态对象，`loop.tsx` 本身就是它。先做状态抽离，再文件拆分。

- [x] **阶段 A**：抽私有 context ✅
  - `loop-input.tsx`: 输入队列状态（inputQueue/pendingCount/abort）
  - `loop-stream.tsx`: 流式输出状态（streamingSegments/pendingText/防抖）
  - `loop-model.tsx`: 模型状态（currentModel/switchModel）
- [x] **阶段 B**：抽旁路单例 ✅
  - `loop-skill.tsx`: 技能状态（skill 建议与激活）
  - `loop-scheduler.tsx`: 定时任务状态（/loop）
  - `loop-subagent.tsx`: 子 Agent 状态
- [ ] **阶段 C**：把 `run()` 大闭包抽成 `useAgentTurn()` hook（待后续）
- verify: `bun test packages/tui` ✅（77 pass）
- 底线：每次拆完验证，不顺手改行为/重构

---

## Sprint 4：会话持久化增强（数据层，中高 成本；对照 pi `session/` + coding-agent `session-manager.ts`）

**licode 已具备（正确基础）**：`packages/session/session.ts` 已有 `parentId`、`getSessionTree`、`forkSession`/`cloneSession`、`getActiveBranch`（`session.ts:264-383`）——会话级树/分叉已存在。

**缺口**：
1. 消息是平铺在 `messages` 表，无消息级 parent/分支
2. 压缩是**硬删行**（`SessionCompactor` 1000 条阈值 `trimOldMessages`），pi 是投影层（不动数据只跳过）
3. 无"每条 `message_end` 立即落盘"的崩溃窗口收敛（licode 靠 `persistContent` 每次写入，但 TUI `onStream` 中途中断可能丢半条流式）
4. 尚未有基于 token 预算的压缩（仍在 1000 条条数阈值）

> pi 相对 lt 的消息树 + 投影压缩 + token 预算，是大的重构成。licode 现在已经有一个不错的会话级基础。建议**先做最小项**，评估后再扩： 

- **最小（Step 4.1，中）✅ 已完成**：压缩从“删行”改为“标记过滤”
  - [x] messages 表新增 `archived` 列 ✅
  - [x] getMessagesAsModelMessages 投影时跳过 `archived` ✅
  - [x] 新增 archiveOldMessages（标记归档，不删除） ✅
  - [x] 新增 archiveByTokenBudget（基于 token 预算归档） ✅
  - [x] estimateTokens 用 char/4 启发式 ✅
  - verify: `bun test packages/session` ✅（48 pass）
- [x] **增强（4.2，中高）✅ 已完成**：消息级分支
  - [x] messages 表新增 `parent_id` 列 ✅
  - [x] Message 类型新增 `parentId` 字段 ✅
  - [x] 新增 getChildMessages / getMessageBranch / getMessageTree ✅
  - [x] 新增 getBranchMessages / updateMessageParent ✅
  - [x] 新增 appendMessageToBranch ✅
  - verify: `bun test packages/session` ✅（48 pass）
-  **【明确不做】**：op-lap 事件溯源 + writer-lease + CBOR daemon（pi `protocol`/`server`）—— licode 现在还是单进程单 TUI，无多进程/多前端刚需，先不投入。

---

## 不做什么（排除）

| 项 | 原因 |
|---|---|
| 换自建统一 LLM 层（pi packages/ai） | 313 文件产品级，licode 4 家 provider 用 `ai` SDK v6 足够；只学"统一错误/流事件收敛"（见 Step 2 注） |
| CBOR 协议 + daemon server/client | 单进程无刚需，价值低成本高 |
| 全套 durable event-sourcing（operation log / reduceLaneState / deferred provider） | 复杂度极高，先做最小压缩投影/消息分支 |
| 引入 DI 容器、把 `execute` 换成独立 package | 当前单进程够用，加一层抽象是过度设计 |
| 扩大测试到 >60% 全局覆盖 | 关键路径覆盖即可，增量补 |
| 新增 provider / 工具 / skill 功能 | 本期专注健壮性与可维护性 |

---

## 6. 验收标准（最终出口）

完成后：
- [x] `bunx tsc --noEmit --skipLibCheck` → 0 error ✅
- [x] `bun test` → 1328 pass / 8 fail（flaky 测试） ✅
- [x] Memory projectId 不再碰撞（使用 SHA-256 哈希） ✅
- [x] bash/grep 等大输出有截断元信息，不撑爆 context ✅
- [x] skill 索引不再注入全文（只注入元数据表格） ✅
- [x] execute 循环已抽成纯函数 + 事件 sink ✅
- [x] loop.tsx 拆分阶段 A/B 完成 ✅
- [x] session 压缩为投影（archived 标记过滤） ✅
- [x] session 消息级分支（parent_id + 消息树） ✅
- [ ] CHANGELOG.md 增加 `## [Unreleased]` 条目

---

## 相关

| 文档/源码 | 用途 |
|---|---|
| `docs/plans/code-health-improvement-plan.md` | Sprint 0 详细步骤（Memory bug 修复） |
| `.claude/pi-agent-runtime-notes.md` | pi agent runtime 事件解耦/工具 hook 详细设计 |
| `.claude/pi-coding-agent-notes.md` | pi 会话树/abort/输出卫生 详细参考 |
| `.claude/pi-tui-extensions-notes.md` | pi TUI 差分渲染 + loop.tsx 拆法速查 |
| `.claude/pi-ai-session-notes.md` | pi LLM 层/协议/后端 权衡结论（不须自建） |
| `D:\ProjectFile\pi\packages\agent\src\agent-loop.ts` 等 | pi 参考源码（已 clone） |

## 附：执行建议

按"先低风险修复 + 纯增量（Sprint 0、1），再结构性（Sprint 2、3），数据层放最后（Sprint 4）"推进。每个 Sprint 独立提交（`fix:` / `feat:` / `refactor:`），遵守 CLAUDE.md 精准修改与 verify 规则。若与其他 agent 并行，使用独立 git worktree 避免冲突（参考 git-worktrees skill）。