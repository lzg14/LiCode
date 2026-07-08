---
name: parallel-agents
description: 并行 subagent —— 独立任务并行派发，依赖任务串行
---

# parallel-agents（并行 subagent）

## 何时用

- 任务可以拆成多个**无依赖**的子任务
- 子任务互不共享文件
- 充分利用多核 / 多模型实例
- 大规模扫描/调研类任务

**不要用于**：子任务有依赖（A 的输出是 B 的输入）、子任务改同一文件、调试类任务（需要上下文连贯）。

## 核心纪律

```
独立 → 并行
依赖 → 串行
并行 + 改文件 → worktree 隔离
subagent 输出被吞 → 本地 verify
```

不要为了并行而强行拆任务；**派 ≥2 个改文件的 subagent 时，必须先用 `git worktree` 给每个 agent 独立工作目录**（避免数据竞争 / 文件锁 / 合并噩梦）。

### ⚠️ Subagent 返回被吞（重要 — 2026-07-08 确认）

subagent 工具的**返回内容被基础设施完全吞掉**，主对话永远只看到 `OK: (无输出)`。**这不是失败**，subagent 实际能正常执行 bash / 读写文件 / git commit。

**应对（强制）**：

1. **派发前**：要求 subagent **把结果写到文件**（如 `.claude/<task>-summary.md`），不要靠返回内容
2. **派发后**：**立即**用 `git status` / `read` 自己 verify 副作用
3. **真失败信号**：verify 命令显示**没有**预期副作用 / 工作树无变化
4. **不要反复重试**同一调用，浪费时间

详见 licode 项目的 `CLAUDE.md` 中"Subagent 派发（强制 verify）"段。

### 多 agent 改文件的硬性规则

```bash
# 1. 起 worktree（每个 agent 一个）
git worktree add ../licode-<feature>-<agent> -b feature/<feature>

# 2. agent 在 worktree 里工作（cwd 指向该路径）
# 3. 完工后用 finishing-branch skill 整合
```

参考 `git-worktrees` skill。

## 我们项目的步骤

1. **拆任务**：列出所有子任务，画依赖图。
2. **无依赖的子任务并行**：用 Agent 工具，每个 subagent 一个 Task。
3. **有依赖的串行**：前一个的输出做后一个的输入。
4. **小任务原则**：每个 subagent 任务控制在 5-10 分钟可完成（CLAUDE.md 规范）。
5. **超时意识**：subagent 失败不会主动通知，要主动检查进度（CLAUDE.md 规范）。
6. **本地 verify 副作用**：subagent 返回永远是 `OK: (无输出)`。派发后**必须**用 `git status --short` / `read .claude/<task>-summary.md` 确认工作真做了。
7. **结果合并**：subagent 返回后整理成统一结果。

## 调度模板

```python
# 伪代码
independent_tasks = [task_a, task_b, task_c]  # 无依赖
dependent_tasks = [task_d, task_e]            # 有依赖

# 第一批并行
results = await parallel([run(t) for t in independent_tasks])

# 第二批串行（依赖第一批）
for t in dependent_tasks:
    result = await run(t, inputs=previous_results)
```

## 反模式

- ❌ 并行改同一文件
- ❌ subagent 任务太大（> 10 分钟）
- ❌ 不检查 subagent 失败就继续
- ❌ 为了并行而拆得太碎（每个 subagent 任务 < 2 分钟就过分了）
- ❌ 看到 `OK: (无输出)` 就重试 / 报错 / 怀疑失败 → **正常行为**，本地 verify 即可
- ❌ 在 prompt 里要求"必须返回结构化 summary" → 永远看不到
- ❌ 不 verify 副作用就相信 subagent 完成了任务
