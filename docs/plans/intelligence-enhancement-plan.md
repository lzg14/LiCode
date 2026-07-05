# licode 智能增强计划 v2

**目标**：让 licode 具备感知、记忆、预测、调度、协作等多维智能能力，用更少资源更快更好完成任务

**日期**：2026-07-05（v2 修订）

**前置版本**：v1 (2026-07-04) — 原始起草，10 M 维度 + 5 phase × 2d 估算

---

## §0 修订说明（v2 增量）

v2 在 v1 基础上做了如下修订：

**新增 8 个章节**：
- §2 与现有架构的关系（M4 接 `packages/memory/` / M2 与 CLAUDE.md 边界 / M3 与 biome 边界）
- §3 价值/成本排序（明确哪些先做、哪些砍）
- §5 跨维度依赖图
- §7 KPI 与度量（含 `eval/` 基准 query set + A/B 框架）
- §8 Feature flag / rollback 设计（每个 M 独立可关）
- §9 数据生命周期 & 隐私边界
- §10 可观察性（决策日志 + `licode doctor`）
- §11 增量发布策略（每 M 一 v0.X.Y）

**修订 4 个章节**：
- §4 十大智能维度 — v1 M5/M7/M8 合并为新 M5「决策智能」；v1 M9 → v2 M7；v1 M10 推迟
- §6 实施路线图 — 2d/phase → 1-2 周/M
- §12 验证标准 — 加 `packages/eval/` 基准
- §13 不做什么 — 追加 4 条（telemetry / cloud / 跨账号 / 个性化推荐）

**v2 修复的核心问题**：
1. M4 不会重复实现 `~/.licode/learning/`，直接扩展 `packages/memory/schema.ts` 的 `type` 字段
2. M2/M3 边界与 CLAUDE.md / biome 明确（不重复实现）
3. M5 不重建 execute phases（v0.3.0 已合并的 7 阶段不再打开潘多拉魔盒）

---

## §1 核心理念

> 体现智能的能力越多，就越能用更少的资源，更快、更高质量的完成工作。

智能不是单一功能，而是多维度的组合。每个维度独立可实施，组合起来产生质变。

---

## §2 与现有架构的关系（NEW v2）

### 2.1 架构边界一览（每个 M 落到哪些现有模块）

| M | 新增 | 集成到 | 不动 |
|---|------|--------|------|
| M1 硬件感知 | `packages/config/{hardware,adaptive}.ts` | `packages/config/loader.ts` | `execute.ts` |
| M2 项目感知 | `packages/config/project-detector.ts` | system prompt 注入 | `CLAUDE.md`（保留 static 部分）|
| M3 代码风格 | `packages/core/style-analyzer.ts` | system prompt 注入 | `biome.config.json`（biome 优先）|
| M4 记忆学习 | `packages/learning/*.ts`（与 `packages/memory/` 旁路）| `packages/memory/schema.ts` 扩展 type | 原 `memory.ts` 不改 |
| M5 决策整合 | `packages/core/intelligence-adapter.ts` | `execute` 主循环 | `phases/`（不重建）|
| M6 错误智能 | `packages/core/error-patterns.ts` | tools 错误回调 | 重试逻辑（保留）|
| M7 时间智能 | `packages/core/temporal-engine.ts` | session 管理 | `compaction`（不重叠）|
| M10 空间智能 | 推迟到 v2.0 | — | — |

### 2.2 M4 接 `packages/memory/` — 关键 schema 扩展

**原 schema**（`packages/memory/schema.ts`）：

```typescript
type: 'memory' | 'notes' | 'checkpoint' | 'progress' | 'feedback'
```

**v2 扩展**（向后兼容，旧 entry 不变）：

```typescript
type: 'memory' | 'notes' | 'checkpoint' | 'progress' | 'feedback'
     | 'tool-stats'    // M4: 工具成功率
     | 'user-pref'     // M4: 用户偏好/纠正
     | 'error-pattern' // M6: 错误模式
```

**关键原则**：
- 不新建 `~/.licode/learning/` 目录
- 不另起 Learning 类
- 复用 `Memory` 类的 `entries: Map<>` + `hardCap` + `maxAgeMs` 机制
- 仅在 v2.0 重新引入独立 `learning/` 模块（如果 M4 规模膨胀到 memory 装不下）

### 2.3 M2 与 CLAUDE.md 边界

| 来源 | 提供 | 不提供 |
|------|------|--------|
| `CLAUDE.md` | 项目规则（push 前 lint、测试命令、不建临时目录等）| 动态检测（lockfile / 框架版本 / 代码规模）|
| M2 project-detector | 动态检测（语言/包管理器/monorepo/test framework）| 静态项目规则（重复 CLAUDE.md 会双 source of truth）|

**集成方式**：M2 输出 JSON 结构，`system-prompt-builder` 把 `CLAUDE.md` 内容 + M2 dynamic 部分**合并注入**到 LLM context。

### 2.4 M3 与 biome 边界

| 层级 | 谁 | 输出 | 失败时 |
|------|---|------|--------|
| 硬规则 | biome | lint error，build 失败 | 必须修 |
| 软引导 | M3 | LLM prompt hint | 提示但不强制 |

**冲突优先级**：`biome > M3`。LLM 生成 biome 看不下去的代码时，biome 自动 fix 兜底。

### 2.5 M5 与 execute phases 边界

v0.3.0 refactor 把 7 阶段合并为单 `execute()`。M5 **不重建 phase 系统**，只做"prompt 注入 + 决策适配层"：

```typescript
// packages/core/intelligence-adapter.ts
export class IntelligenceAdapter {
  // 入口: execute() 主循环前调用
  beforeExecute(ctx: ExecuteContext): AugmentedPrompt
  
  // 出口: execute() 完成后调用
  afterExecute(ctx: ExecuteContext, result: ExecuteResult): Feedback
}
```

不引入 DAG、不引入新 phase、不重写 loop。

---

## §3 价值/成本排序（NEW v2）

按价值/成本比从高到低排序：

| 优先级 | M | 工作量 | 价值 | 状态 |
|--------|---|--------|------|------|
| 🥇 MVP-A | M1 硬件感知 | 1 周 | 立刻防低配机器跑炸 | 已有 `hardware-adaptive-design.md`，next |
| 🥇 MVP-B | M4 记忆学习 | 1-2 周 | 跨会话积累 | 已有 schema 基础（`feedback` type）|
| 🥈 | M2 项目感知 | 2 周 | system prompt 个性化 | 与 CLAUDE.md 互补 |
| 🥉 | M3 代码风格 | 1 周 | LLM 输出质量 | 与 biome 协同 |
| ⏸️ | M6 错误智能 | 2 周 | 错误恢复 | 等 M4 学习数据 |
| ⏸️ | M7 时间智能 | 1-2 周 | 空闲利用 | 需要 session 改造 |
| 🔀 整合 | M5 决策整合 | 4 周 | adapter 层 | 等 M2/M4 完成后做 |
| ❄️ 推迟 | M10 空间智能 | — | AST 项目地图 | v2.0（用户对 AST 地图需求不强）|

**砍掉的 v1 M**：
- v1 M5「预测智能」+ M7「流程智能」+ M8「协作智能」 → 合并为 v2 M5「决策整合」（避免 decision tangle，三个 M 同时做决策会互相否决）
- v1 M10「空间智能」 → 推迟到 v2.0（glob/codesearch 已基本满足需求）

**MVP 推进建议**（前 1-2 个月）：

```
Week 1:    M1 spike（hardware.ts 100 行，no deps）
Week 2-3:  M4 落 schema 扩展（tool-stats / user-pref 两个新 type）
Week 4-5:  M1 完整（含 adaptive.ts + 替换 main/subagent 硬编码）
Week 6-7:  M4 集成（tool 回调记录 + system prompt 注入学习数据）
Week 8:    eval 框架（packages/eval/，M1+M4 跑过基线）
```

---

## §4 十大智能维度（v1 主体 + v2 边界补充）

### M1. 硬件感知自适应（Resource Intelligence）

**核心**：自动检测 CPU/内存/磁盘，动态调整系统行为

| 检测项 | API | 调整目标 |
|--------|-----|----------|
| CPU 核心数 | `os.cpus().length`（注意容器 cgroup 限制）| 并发数、批处理大小 |
| 内存大小 | `os.totalmem()` | 缓存阈值、保留消息数 |
| 磁盘类型 | 平台命令（macOS `diskutil info` / Linux `lsblk -d -o name,rota` / Windows `wmic diskdrive`）| IO 策略（批量 vs 流式）|
| 空闲内存 | `os.freemem()` | 运行时动态调整 |

**硬件分级**：

| tier | CPU | 内存 | 行为 |
|------|-----|------|------|
| low | ≤ 2 核 | ≤ 4 GB | 保守：并发 2、缓存 500 条、token 4K |
| medium | 3-8 核 | 4-16 GB | 默认：并发 3、缓存 1000 条、token 8K |
| high | > 8 核 | > 16 GB | 激进：并发 6、缓存 2000 条、token 16K |

**实施**：
- [ ] 创建 `packages/config/hardware.ts`（采集模块）
- [ ] 创建 `packages/config/adaptive.ts`（映射规则）
- [ ] 集成到 `packages/config/loader.ts`（启动时采集）
- [ ] 替换 `main.ts` / `subagent.ts` / `session-compactor.ts` 硬编码值
- [ ] 编写测试 + 跨平台（macOS / Linux / Windows）

**v2 风险点**：
- 容器环境 CPU 检测不准确（`os.cpus()` 返回宿主，不是 cgroup 限制）→ 增加 `cgroup v1/v2` 检测
- Windows SSD/HDD 检测无原生 API → fallback 到"不区分，按 IO 性能自动分级"
- 监控时机：启动一次 vs 周期性？v2 决定**启动一次**（避免运行时调参带来的非确定性）

---

### M2. 项目感知（Project Intelligence）

**核心**：自动检测项目语言/框架/结构，优化工具选择和 prompt

**检测维度**：

| 维度 | 检测方法 | 优化行为 |
|------|----------|----------|
| 编程语言 | `tsconfig` / `pyproject.toml` / `go.mod` | 选择对应 linter 和类型检查 |
| 前端框架 | `package.json` deps | 调整组件生成策略 |
| 包管理器 | lock 文件（`bun.lockb` / `pnpm-lock.yaml` / `yarn.lock`）| 使用对应命令 |
| 是否 monorepo | workspace 配置（`pnpm-workspace.yaml` 等）| 限定搜索范围 |
| 测试框架 | `package.json` scripts | 改完自动跑相关测试 |
| 代码规模 | `find . -name "*.ts" -not -path "./node_modules/*" \| wc -l`（限制扫描深度）| 调整 context window 预算 |
| 项目年龄 | `git log --reverse --format=%ct \| head -1` | 老项目更保守，新项目更灵活 |

**system prompt 动态注入**：

```
## 项目感知（M2 自动检测）
- 语言：TypeScript（strict mode）
- 框架：SolidJS + opentui（终端 UI）
- 测试：vitest
- 规范：biome lint
- 改动后自动运行：bunx tsc --noEmit && bun test

## 项目规则（来自 CLAUDE.md）
- 推送前 lint 用 bunx tsc 而非 ruff（CLAUDE.md 静态部分）
- 工程根不要建临时目录（CLAUDE.md 约束）
```

**实施**：
- [ ] 扩展 `packages/core/detect-project.ts`（如果不存在）
- [ ] 创建 `packages/config/project-detector.ts`（统一入口）
- [ ] 动态调整 `packages/core/phases/execute/prompts.ts`
- [ ] 编写测试 + 缓存机制（5 分钟内不重复检测）

**v2 风险点**：
- `find . -name "*.ts" | wc -l` 在 10K 文件 monorepo 卡 30s+ → 加深度限制（默认 3 层）+ 缓存
- `git log --reverse` 在 shallow clone 不准确 → fallback 到"未知"
- 与 `CLAUDE.md` 边界（§2.3）：M2 不重复 CLAUDE.md 静态内容

---

### M3. 代码风格感知（Code Style Intelligence）

**核心**：扫描项目现有代码，学习风格规范，生成代码时匹配

**学习维度**：

| 维度 | 检测方法 | 应用 |
|------|----------|------|
| 缩进风格 | 解析前 10 个 .ts 文件 | 新文件用相同缩进 |
| 命名约定 | camelCase / snake_case 统计 | 函数/变量命名 |
| 导入风格 | `import type` vs `import` 比例 | 生成导入语句 |
| 注释密度 | 注释行 / 代码行 比例 | 决定是否加注释 |
| 错误处理风格 | try-catch vs .catch 比例 | 生成错误处理 |
| 类型标注风格 | 显式类型 vs 类型推断 | 决定是否标注类型 |

**v2 关键问题**：
- biome 已经强制风格，**M3 与 biome 谁说了算**？v2 决策：**biome 硬规则优先**（§2.4）
- legacy 代码风格不一定是好的（如老代码不写类型）→ M3 学的是"现状"不一定是"正确"

**实施**：
- [ ] 创建 `packages/core/style-analyzer.ts`
- [ ] 在 system prompt 中注入风格规范（软引导）
- [ ] 编写测试 + 缓存（只扫一次/项目）

**v2 风险点**：
- 解析前 10 个文件是 heuristic（不是 ground truth）→ 加统计置信度（< 70% 置信不注入）
- 与 biome 冲突时，biome 修复兜底

---

### M4. 记忆与学习（Memory & Learning Intelligence）

**核心**：记录成功/失败模式，跨会话积累经验

**v2 重大修订**：v1 提议新建 `~/.licode/learning/`，v2 改为**扩展 `packages/memory/schema.ts`**（§2.2）

**记忆类型**（接 `MemoryEntry.type`）：

| type | 用途 | 存储 |
|------|------|------|
| `tool-stats` | 工具调用成功率 / 平均耗时 | `~/.licode/memory/projects/{id}/tool-stats.json` |
| `user-pref` | 用户偏好/纠正（自动清理 >90 天）| 同上 |
| `error-pattern` | 常见错误模式（M6 复用）| 同上 |
| `feedback`（已有）| 显式用户反馈 | 已有 |
| `progress`（已有）| 会话进度 | 已有 |

**学习→优化映射**：

| 事件 | 记录 | 后续影响 |
|------|------|----------|
| bash 工具执行超时 | `tool-stats` timeout_count++ | 超过 3 次 → 推荐拆分命令 |
| edit 工具找不到 oldString | `tool-stats` miss_count++ | 超过 2 次 → 改用 read+write |
| 用户删除生成的注释 | `user-pref` no_comments++ | 超过 3 次 → 以后不加注释 |
| 用户手动修复类型错误 | `user-pref` type_fix++ | 超过 2 次 → 生成时更注意类型 |
| 某错误重复 5 次 | `error-pattern` | M6 自动修复尝试 |

**实施**：
- [ ] 扩展 `packages/memory/schema.ts`（加 3 个 type）
- [ ] 创建 `packages/learning/recorder.ts`（在 memory 旁，不在 memory 内）
- [ ] 在工具执行后 `recorder.record(toolName, success, duration)`
- [ ] 在 `execute` 主循环中读取 `Memory.entries.filter(type='user-pref')` 注入 prompt
- [ ] 编写测试 + 数据保留（90 天自动清，§9.1）

**v2 风险点**：
- "bash 超时 3 次"误报高（一次长命令正常超时）→ 加置信度（同时考虑 timeout 时长）
- 隐私边界（§9）— 行为追踪需要 consent
- 数据 schema 与 `packages/memory/` 完全融合，不能有数据迁移期

---

### M5. 决策整合（合并 v1 M5 + M7 + M8）

**v2 关键决策**：v1 三个独立 M（预测 / 流程 / 协作）合并为一个 "adapter 层"，避免 decision tangle（三个 M 同时做决策会互相否决）。

**核心**：在 `execute` 主循环前后注入"决策适配层"，综合 4 类信号：

```
┌────────────────────────────────────────────────────────┐
│              IntelligenceAdapter (v2 M5)               │
├────────────────────────────────────────────────────────┤
│ Inputs:                                                │
│   - M4 user-pref (用户偏好)                            │
│   - M4 tool-stats (历史工具成功率)                      │
│   - M2 project context (项目类型)                       │
│   - M3 style hints (代码风格)                          │
│                                                        │
│ Decisions:                                             │
│   - 工具推荐（用 edit 还是 read+write？）               │
│   - 任务深度（深度探索 vs 快速回答）                    │
│   - 确认频率（每步确认 vs 一次确认到底）                │
│   - 详细度（简洁 vs 详细）                             │
│                                                        │
│ Outputs:                                               │
│   - 增强的 system prompt                               │
│   - 工具选择提示                                       │
│   - 用户确认策略                                       │
└────────────────────────────────────────────────────────┘
```

**v1 三个 M 内容整合**（去重 + 合并）：

| 来源 | 内容 | v2 位置 |
|------|------|--------|
| v1 M5 预测 | 影响范围预判 / 完成时间预估 | M5 decision 1 |
| v1 M7 流程 | TDD vs 修 / 并行 vs 串行 | M5 decision 2 |
| v1 M8 协作 | 详细度 / 确认偏好 / 语言适配 | M5 decision 3 |

**实施**：
- [ ] 创建 `packages/core/intelligence-adapter.ts`（单 adapter，无 DAG）
- [ ] `beforeExecute(ctx)` 返回 `AugmentedPrompt`
- [ ] `afterExecute(ctx, result)` 写入 `Memory`（recorder）
- [ ] 编写测试 + A/B 对比（§7.3）

**v2 风险点**：
- 不重建 phase 系统（v0.3.0 合并的 7 阶段不再打开）→ 严格 adapter 模式（§2.5）
- "决策错误时如何 fallback"：每个 decision 都有 default 路径（adapter 失败 → 走原 LLM 行为）
- 跨用户冲突：adapter 决策基于 `user-pref`，需要按 `machine_user_id` 隔离（§9.2）

---

### M6. 错误智能（Error Intelligence）

**核心**：少犯重复错，优雅降级

**错误处理策略**：

| 错误类型 | 当前行为 | 智能行为 |
|----------|----------|----------|
| 网络超时 | 重试 3 次 | 指数退避 + 切换 provider |
| TypeScript 类型错误 | 报错 | 自动推断正确类型（仅高置信度）|
| 工具执行失败 | 返回错误 | 降级到替代方案 |
| LLM 响应为空 | 报错 | 调整 prompt 重试 |
| 文件不存在 | 报错 | 搜索相似文件名（glob）|
| 权限不足 | 报错 | 建议用 sudo 或改路径 |

**自动修复能力**：

| 错误模式 | 自动修复 |
|----------|----------|
| `Module not found: './foo'` | 检查大小写、扩展名、路径 |
| `Type 'X' is not assignable to 'Y'` | 尝试类型断言或类型收窄（仅当 `error-pattern` 命中率 > 80%）|
| `Cannot find name 'xxx'` | 检查导入语句 |
| `Unexpected token` | 检查括号匹配、分号 |

**实施**：
- [ ] 创建 `packages/core/error-patterns.ts`（模式库）
- [ ] 在工具执行中集成自动修复（after 失败 → lookup pattern）
- [ ] 写入 `error-pattern` type 到 `Memory`（持久化新模式）
- [ ] 编写测试

**v2 风险点**：
- "自动推断类型" LLM 已经在做，agent 介入引入新错误成本高 → 仅在 `error-pattern` 高置信（>80%）时介入
- 错误模式库是 retrofit，需要持续更新（每天扫新增错误）

---

### M7. 时间智能（Temporal Intelligence，原 v1 M9）

**核心**：用得好时机，减少等待

**时间策略**：

| 策略 | 触发条件 | 行为 |
|------|----------|------|
| 空闲预计算 | 用户无输入 > 5s | 预分析最近修改的文件（仅 CPU 空闲时）|
| 批量合并 | 连续 5 次小改动 | 合并成一次 commit（仅显示提示，不自动 commit）|
| 过期清理 | 临时文件 > 7 天 | 自动清理 |
| 会话边界 | 话题切换检测 | 自动摘要 + 新话题 |
| 延迟执行 | 非关键操作 | 积攒后批量执行 |

**会话边界检测**：

| 信号 | 权重 |
|------|------|
| 用户说"好的/完成/下一个" | 高（但避免假阳性：很多人当流程性表达）|
| 时间间隔 > 10 分钟 | 中 |
| 话题关键词变化 | 中 |
| 项目目录切换 | 高 |

**实施**：
- [ ] 创建 `packages/core/temporal-engine.ts`
- [ ] 在 session 管理中集成（hook on `onMessage` / `onIdle`）
- [ ] 编写测试 + 阈值调优

**v2 风险点**：
- "空闲 > 5s 预计算"会耗电 & 抢占 CPU → 增加"CPU 空闲"判断（load average < 1）
- "会话边界"假阳性高 → 阈值保守（只对高权重信号触发）

---

### (M8-M9 占位：v1 M8/M5 合并到 M5，v1 M9 改为 M7)

---

### M10. 空间智能（**v2 推迟到 v2.0**）

**v2 决策**：推迟。

**理由**：
- 用户对 AST 项目地图需求不强（glob/codesearch 已基本满足）
- 启动时构建 AST 重（10K 文件 30s+）
- 与 M2 项目感知功能重叠

**v2.0 重新评估**（如果 v1.0 智能版跑得通）。

---

## §5 跨维度依赖图（NEW v2）

```
                   ┌─────────────────────────┐
                   │  execute() 主循环 (现有)  │
                   └────────────┬────────────┘
                                │ 前后 hook
                                ▼
              ┌─────────────────────────────────┐
              │   M5 IntelligenceAdapter       │
              │   (决策整合层)                  │
              └──────┬──────────────┬───────────┘
                     │              │
            ┌────────▼───┐    ┌────▼─────────┐
            │ Inputs:    │    │ Outputs:     │
            │ M2 项目   │    │ system prompt│
            │ M3 风格   │    │ tool 提示     │
            │ M4 偏好   │    │ fallback 路径│
            └──────┬────┘    └──────────────┘
                   │
        ┌──────────┼──────────┬──────────────┐
        ▼          ▼          ▼              ▼
     M1 硬件    M2 项目   M3 风格      M4 记忆
   (config)  (config)   (style)      (memory)
                                                
              ┌──────────┐
              │ M6 错误   │  ←── 读 M4 error-pattern
              └──────────┘
              
              ┌──────────┐
              │ M7 时间   │  ←── 独立 (session hook)
              └──────────┘
```

**实施顺序**（dependency 决定）：

| Step | 内容 | 依赖 |
|------|------|------|
| 1 | M1 硬件感知 | 无 |
| 2 | M4 记忆（schema 扩展）| 无 |
| 3 | M2 项目感知 | 无 |
| 4 | M3 代码风格 | 无 |
| 5 | M6 错误智能 | M4 error-pattern |
| 6 | M5 决策整合 | M2 + M3 + M4 |
| 7 | M7 时间智能 | session 改造 |
| 8 | v2.0: M10 空间智能 | M2 项目感知完整 |

**关键依赖**：M5 必须等 M2/M3/M4 都有数据，否则 adapter 决策靠默认值，等于无 adapter。

---

## §6 实施路线图（修订 v2）

**v1 估算**：5 phase × 2d = 10d（**严重低估**）

**v2 估算**：每 M 1-2 周，整个 v1.0 智能版 13-19 周（3-5 个月）

| Phase | 内容 | 估算 | 前置 |
|-------|------|------|------|
| **Phase 0** | Spike / eval 框架 | 1 周 | — |
| **Phase 1** | M1 + M4 数据层基础 | 4-6 周 | Phase 0 |
| **Phase 2** | M2 + M3 感知增强 | 3 周 | Phase 1 |
| **Phase 3** | M5 决策整合 | 4 周 | Phase 1 + 2 |
| **Phase 4** | M6 + M7 应用层 | 3-4 周 | Phase 3 |
| **Phase 5** | 灰度/调优/v0.5.0 stable | 2-4 周 | Phase 4 |
| **总计** | **v1.0 智能版** | **13-19 周** | — |

每个 M 内部：
- 设计 (1-2 天)
- Coding (2-5 天)
- 测试 (1-2 天)
- 集成 (1-2 天)
- 灰度 / 文档 (1-2 天)

---

## §7 KPI 与度量（NEW v2）

### 7.1 核心指标

| 维度 | 指标 | 目标（vs 基线）| 测量方法 |
|------|------|----------------|----------|
| **用户价值** | Task completion rate | +10% | `packages/eval/scenarios.bench.ts` |
| **用户价值** | 平均轮次（turns to done）| -15% | 同上 |
| **用户价值** | 重做率（用户重写生成）| -20% | hook on edit |
| **性能** | First-token latency p95 | 不退化 >5% | timing hook |
| **性能** | 总 token / task | -10% | usage log |
| **稳定性** | Core dump rate | 不增加 | Sentry / sentry-like |
| **稳定性** | User "undo" rate | -20% | git undo frequency |
| **可信** | 用户关掉 M 后的投诉率 | 0 | feedback |
| **可观察性** | 决策日志覆盖率 | 100% | `licode doctor` |

### 7.2 `packages/eval/` 基准 query set

```typescript
// packages/eval/scenarios.bench.ts
export interface Scenario {
  id: string
  prompt: string
  setup?: () => Promise<void>     // 准备环境
  teardown?: () => Promise<void>  // 清理
  expect: {
    toolCalls: string[]           // 期望工具序列
    turns: { max: number; min?: number }
    successCriteria: 'file_changed' | 'test_passes' | 'lint_clean'
  }
  tier: 'easy' | 'medium' | 'hard'
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'fix-ts-error',
    prompt: 'packages/cli/logs.ts:42 有 TS error TS2345, 修复',
    expect: { toolCalls: ['read', 'edit'], turns: { max: 5 } }
  },
  {
    id: 'add-feature',
    prompt: '给 SessionCompactor 加 hard cap 1000',
    expect: { toolCalls: ['read', 'grep', 'edit', 'bash', 'bash'], turns: { max: 10 } }
  },
  {
    id: 'refactor-style',
    prompt: '把 packages/core/execute.ts 重命名 executePhases 为 execute',
    expect: { toolCalls: ['grep', 'read', 'edit', 'grep', 'bash'], turns: { max: 8 } }
  },
  // ... 50-100 个标准化任务
]
```

### 7.3 A/B 框架

```bash
# 关掉所有 M（对照基线）
licode eval --no-intelligence

# 开指定 M
licode eval --enable=M1,M4

# 开所有
licode eval --full

# 对比两次结果
licode eval --compare baseline,intelligence
# → eval/reports/{date}.md
# → eval/reports/{date}.json
```

### 7.4 自动报告

`eval` 命令跑完生成：

- `eval/reports/{YYYY-MM-DD}.md` — 人类可读对比报告
- `eval/reports/{YYYY-MM-DD}.json` — 机器可读（CI 比对）
- 关键字段：
  - task_completion_rate (baseline vs treatment)
  - avg_turns (baseline vs treatment)
  - p95_latency
  - token_cost
  - failure_modes（哪些 query 退化/变好）

### 7.5 CI 集成

```yaml
# .github/workflows/eval.yml
- name: Run eval
  run: |
    bun run eval --baseline  # 记录到 eval/baseline.json
    bun run eval --full      # 跑 v2 treatment
    bun run eval --compare   # 生成报告
- name: Check regression
  run: |
    # 任何指标退化 > 5% → fail
    bun run eval --check-regression
```

---

## §8 Feature flag / rollback 设计（NEW v2）

### 8.1 Schema

```typescript
// packages/config/schema.ts
export interface IntelligenceConfig {
  enabled: boolean              // 总开关
  modules: {
    hardware: boolean           // M1
    project: boolean            // M2
    style: boolean              // M3
    memory: boolean             // M4
    adapter: boolean            // M5
    errorPatterns: boolean      // M6
    temporal: boolean           // M7
  }
}

export const DEFAULT_INTELLIGENCE_CONFIG: IntelligenceConfig = {
  enabled: false,                // 默认关，灰度开启
  modules: {
    hardware: true,              // 已有 design，可直接开
    project: false,              // 等 v0.4.3
    style: false,                // 等 v0.4.4
    memory: true,                // 已有 schema，可直接开
    adapter: false,              // 等 v0.4.5
    errorPatterns: false,        // 等 v0.4.6
    temporal: false,             // 等 v0.4.7
  }
}
```

### 8.2 CLI 控制

```bash
licode config intelligence list                 # 列出所有 M 开关
licode config intelligence enable memory         # 开 M4
licode config intelligence disable memory        # 关 M4
licode config intelligence enable --all          # 开所有
licode config intelligence reset                 # 重置默认
```

### 8.3 环境变量 override

```bash
# 紧急 disable（不写配置文件）
LICODE_INTELLIGENCE_ENABLED=false licode

# 临时关某 M
LICODE_INTELLIGENCE_MEMORY=off licode
```

### 8.4 配置文件

```yaml
# .licode/config.yaml
intelligence:
  enabled: true
  modules:
    hardware: true
    project: true
    style: true
    memory: true
    adapter: false      # 实验性
    errorPatterns: true
    temporal: true
```

### 8.5 紧急 rollback

```bash
# 全部关（应急 / debugging）
LICODE_INTELLIGENCE_ENABLED=false licode
# 等价于把所有 module disable
```

### 8.6 自动回滚

```typescript
// packages/core/intelligence-adapter.ts
export class IntelligenceAdapter {
  private consecutiveFailures = 0
  
  afterExecute(ctx, result) {
    if (result.failed) {
      this.consecutiveFailures++
      if (this.consecutiveFailures > 5) {
        // 5 次连续失败 → 自动 disable 当前 M
        devLogger.warn(`Intelligence module ${this.module} auto-disabled due to 5 consecutive failures`)
        config.intelligence.modules[this.module] = false
      }
    } else {
      this.consecutiveFailures = 0
    }
  }
}
```

---

## §9 数据生命周期 & 隐私边界（NEW v2）

### 9.1 数据保留期

| 数据（MemoryEntry.type）| 保留期 | 删除策略 |
|------------------------|--------|----------|
| `tool-stats` | 90 天 | 90 天前自动清（基于 `updatedAt`）|
| `user-pref` | 永久 | 用户可手动重置 |
| `error-pattern` | 永久（验证后）| 用户可手动删 |
| `feedback`（已有）| 永久 | 用户可手动删 |
| `progress`（已有）| 跟随 session 生命周期 | session 删时清 |

### 9.2 跨用户隔离

- 默认路径：`~/.licode/memory/projects/{projectId}/`
- 多用户同机器：注入 `machine_user_id` 到 metadata（不暴露给 LLM）
- 路径隔离：`memory_path` 加入 `${machine_user_id}` 前缀

```typescript
// packages/memory/memory.ts
const baseDir = config.baseDir ?? join(homedir(), '.licode', 'memory', machineUserId, projectId)
```

### 9.3 Consent 流程

首次启用 M4 时（非静默启用）：

```
┌──────────────────────────────────────────────────────────┐
│  💡 licode 将学习你的使用习惯来优化响应                      │
│                                                          │
│  • 工具调用成功率                                          │
│  • 错误模式（自动修复）                                     │
│  • 你的纠正记录（删除注释、改类型等）                          │
│                                                          │
│  数据本地存储，不上传                                        │
│  随时关闭: licode config intelligence disable memory       │
│  随时清除: licode config intelligence purge                │
│                                                          │
│  [ 启用 ]   [ 暂不启用 ]                                   │
└──────────────────────────────────────────────────────────┘
```

非交互场景（CI / script）：使用环境变量 `LICODE_INTELLIGENCE_MEMORY=on` 显式开启，否则默认关。

### 9.4 GDPR-like 接口

```bash
licode config intelligence export > my-data.json  # 导出所有学习数据
licode config intelligence purge                  # 删所有学习数据（保留非 learning）
licode config intelligence audit                   # 看收集了什么
```

### 9.5 隐私原则

1. **No cloud upload** — M4 数据永远 local
2. **No telemetry** — 不上报"用户行为"
3. **No cross-account** — 多用户同机器物理隔离（`machine_user_id` 前缀）
4. **No marketing** — 不做"猜你想做"推荐
5. **Default off** — 实验性 M 默认关（`adapter: false`），需用户显式开
6. **First-run consent** — M4 首次启用显示透明告知（非静默）

---

## §10 可观察性（NEW v2）

### 10.1 决策日志格式

```jsonl
// ~/.licode/logs/intelligence/{YYYY-MM-DD}.jsonl
{"ts": "2026-07-05T10:23:45Z", "module": "M5", "decision": "use_tool", "context": {"tool": "edit", "success_rate": 0.92}, "result": "ok", "fallback": false}
{"ts": "2026-07-05T10:23:46Z", "module": "M2", "decision": "inject_prompt", "context": {"detected": "ts+vitest"}, "result": "appended", "cache_hit": true}
{"ts": "2026-07-05T10:23:50Z", "module": "M4", "decision": "record", "context": {"event": "tool_timeout", "count": 4}, "result": "ok"}
```

日志**默认不写**（性能 + 体积），需 `LICODE_DEBUG=intelligence` 开启。

### 10.2 `licode doctor` 命令

```bash
$ licode doctor
[hardware]    CPU 4 cores, 8GB RAM → medium tier ✓
[project]     TypeScript + SolidJS, monorepo no ✓
[style]       biome + detected indent=2, quote=double ✓
[memory]      124 entries (last 30 days), no stale ✓
[adapter]     disabled (experimental, see config)
[error-patterns] 8 patterns loaded
[temporal]    0 sessions tracked
[decision-log] 234 events today, 0 errors
[config]      intelligence.enabled=true, 5/7 modules on
[privacy]     no cloud upload, machine_user_id=abc123
```

### 10.3 调试模式

```bash
LICODE_DEBUG=intelligence licode
# 详细打印每个 M 决策 + 决策理由

LICODE_DEBUG=intelligence,project,style licode
# 逗号分隔，subset debug
```

### 10.4 指标导出（Prometheus 格式）

```bash
$ licode config intelligence metrics
# HELP licode_intelligence_decisions_total Decisions made by intelligence modules
# TYPE licode_intelligence_decisions_total counter
licode_intelligence_decisions_total{module="M1"} 42
licode_intelligence_decisions_total{module="M4"} 128
# HELP licode_intelligence_fallback_total Fallback to default path
# TYPE licode_intelligence_fallback_total counter
licode_intelligence_fallback_total{module="M5"} 3
```

可接入 Prometheus / Grafana 监控（本地或远端，但 v2 不内置）。

---

## §11 增量发布策略（NEW v2）

### 11.1 版本节奏

每 M 一个 v0.X.Y（patch）版本：

| 版本 | 内容 | 状态 |
|------|------|------|
| v0.4.0（已发布）| — | released |
| **v0.4.1** | M1 硬件感知 | Phase 1.1 |
| **v0.4.2** | M4 记忆学习（schema 扩展 + 工具回调）| Phase 1.2 |
| **v0.4.3** | M2 项目感知 | Phase 2.1 |
| **v0.4.4** | M3 代码风格 | Phase 2.2 |
| **v0.4.5** | M5 决策整合（adapter 层）| Phase 3 |
| **v0.4.6** | M6 错误智能 | Phase 4.1 |
| **v0.4.7** | M7 时间智能 | Phase 4.2 |
| **v0.4.8** | 灰度调优 / 调参 | Phase 5 |
| **v0.5.0** | "Intelligence" feature flag stable，默认开 | Phase 5 末 |

### 11.2 灰度策略

每个 M 默认关（`config: enabled: false`） → 小范围 dogfood → 测 → 默认开。

```typescript
// v0.4.1: M1 默认 false
modules: { hardware: false }

// v0.4.2: M1 默认 true（已稳定）
modules: { hardware: true }
```

### 11.3 兼容性

新 M 不会 break 现有 user：
- M4 写新 type 时兼容旧 memory entry（type 字段为枚举，新增值不破坏）
- M2 检测失败 → fallback 到 default config
- M5 决策失败 → 走 LLM 默认路径（adapter 失败不 crash）
- M6 错误修复失败 → 返回原 error（不静默吞）

### 11.4 RELEASING.md 增量

每次新 M 发布，RELEASING.md 加一行：
- v0.4.1: 新增 M1 硬件感知（feature flag 默认关）
- v0.4.2: 新增 M4 记忆学习（接 packages/memory/，新增 3 个 type）
- ...

---

## §12 验证标准（修订 v2）

每个 M 必须满足：

1. ✅ `bunx tsc --noEmit --skipLibCheck` 通过
2. ✅ `bun test` 全量通过
3. ✅ `bun test packages/eval` 基准不退化（completion rate / turns / latency）
4. ✅ `licode doctor` 报告该 M 状态
5. ✅ `LICODE_DEBUG=intelligence licode` 决策日志清晰
6. ✅ 至少 1 个 e2e 场景覆盖（`packages/eval/scenarios.bench.ts`）
7. ✅ 文档更新（CLAUDE.md / RELEASING.md / 必要 docs/plans/）
8. ✅ 灰度 config 默认关 → 不影响未启用 user
9. ✅ Privacy 审计（无 PII 泄露，无 telemetry）
10. ✅ `licode config intelligence disable <M>` 后行为完全等同 v1 baseline

---

## §13 不做什么（追加 v2）

v1 已列：

- ❌ 不引入 ML 模型推理（用规则引擎足够）
- ❌ 不做远程硬件检测（只检测本机）
- ❌ 不加 Web UI 监控面板（终端工具不需要）
- ❌ 不做分布式调度（单机场景）
- ❌ 不引入 DI 容器（当前单例够用）

v2 追加：

- ❌ 不加 telemetry 上报
- ❌ 不做 cloud sync（M4 数据永远 local）
- ❌ 不做跨账号迁移（多用户同机器物理隔离）
- ❌ 不做个性化广告/营销推荐
- ❌ 不引入重型 ML 模型（>100MB 模型由 LLM 处理）
- ❌ 不重做 execute phases（M5 只做 adapter，不重建 phase）
- ❌ 不重做 biome 规则（M3 只 LLM prompt hint，biome 硬规则优先）

---

## §14 现实时间估算（修订 v2）

| Phase | 内容 | 估算 | 累计 |
|-------|------|------|------|
| Phase 0 | Spike（eval 框架 + M1 hardware.ts 100 行原型）| 1 周 | 1 周 |
| Phase 1 | M1 + M4 数据层（schema 扩展 + 集成）| 4-6 周 | 5-7 周 |
| Phase 2 | M2 + M3 感知增强 | 3 周 | 8-10 周 |
| Phase 3 | M5 决策整合（adapter 层）| 4 周 | 12-14 周 |
| Phase 4 | M6 + M7 应用层 | 3-4 周 | 15-18 周 |
| Phase 5 | 灰度 / 调优 / v0.5.0 stable | 2-4 周 | 17-22 周 |
| **总计** | **v1.0 智能版** | **17-22 周（4-5 个月）** | — |

**每个 M 的内部时间分配**：

- 设计：1-2 天
- Coding：2-5 天
- 测试：1-2 天
- 集成：1-2 天
- 灰度 + 文档：1-2 天
- 合计：1-2 周

**M5 决策整合**作为整合模块：4 周（包含拆原来 3 个 M 的复杂度）。

**M10 空间智能**：v2.0 重新评估，不计入 v1.0 时间。

---

## §15 修订历史

- **v2 (2026-07-05)** — critical review 后修订：
  - 新增 8 章节（§2 架构边界 / §3 价值排序 / §5 依赖图 / §7 KPI / §8 Feature flag / §9 隐私 / §10 可观察性 / §11 增量发布）
  - 修订 4 章节（§4 10 M 主体 / §6 时间估算 / §12 验证标准 / §13 不做什么）
  - 砍 3 M → 整合：v1 M5/M7/M8 → v2 M5 决策整合
  - 推迟 1 M：v1 M10 → v2.0
  - v1 M9 → v2 M7（重编号）
  - 修复 3 个核心问题：
    - M4 接 `packages/memory/`（不另建 `learning/` 目录）
    - M2/M3 边界与 CLAUDE.md/biome 明确
    - M5 不重建 phase 系统
- **v1 (2026-07-04)** — 原始起草：10 M 维度 + 5 phase × 2d 估算（严重低估）

---

## 附录 A：相关文件

- **设计文档**：
  - `docs/plans/hardware-adaptive-design.md` — M1 详尽设计（12KB）
  - `docs/plans/hardware-adaptive-architecture-plan.md` — M1 实施计划（7KB）
- **现有架构**：
  - `packages/config/` — 配置系统（M1/M2 集成点）
  - `packages/memory/` — 记忆系统（M4 集成点）
  - `packages/core/phases/execute.ts` — execute 主循环（M5 hook 点）
  - `CLAUDE.md` — 项目静态规则（M2 不重复）

## 附录 B：相关待办

- T13：bump 脚本自动化（`bun run bump` 自动改 2 处版本号）
- T14：eval 框架初始（`packages/eval/` + `bun run eval`）
- T15：M1 hardware.ts 实现（按 hardware-adaptive-design.md）
- T16：M4 schema 扩展（`packages/memory/schema.ts` 加 3 个 type）
- T17：consensus 流程 UI（`licode` 首次启动交互）
