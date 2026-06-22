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
```

不要为了并行而强行拆任务；**派 ≥2 个改文件的 subagent 时，必须先用 `git worktree` 给每个 agent 独立工作目录**（避免数据竞争 / 文件锁 / 合并噩梦）。

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
6. **结果合并**：subagent 返回后整理成统一结果。

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
