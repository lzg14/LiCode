# 归档文档（已废弃 / 历史设计）

> 本目录存放**已废弃、过期或不再维护**的设计文档和评估报告。
>
> **当前活跃内容**请参见 [`../README.md`](../README.md)。

---

## 归档规则

文档移入 `archive/` 的条件（满足任一）：

1. **已过期**：被新版本完整替代，且新版本在 `docs/` 顶层或 `plans/` 中可查
2. **已废弃**：设计原则不再适用（如 Core Loop 7 阶段被简化为单阶段）
3. **设计变更**：原计划目标已通过其他方式完成，或方向已调整

归档**不**意味着内容错误 — 仅表示其作为"决策记录"保留，而非"实施依据"。

---

## 目录内容（按时间倒序）

### 评估报告

| 文档 | 日期 | 归档原因 | 替代文档 |
|------|------|---------|---------|
| [2026-07-15-assessment.md](./2026-07-15-assessment.md) | 2026-07-15 | 一个月内已完成 12/17 项建议（bun 白名单、安全联动、LLM 重试、Provider fallback、配置错误、核心测试） | [production-gaps-2026-q3.md](../plans/production-gaps-2026-q3.md) |

### Core Loop 旧设计（2026-06-17，v1.7.0 ~ v2.0.0）

2026-06-17 的 Core Loop 设计采用 7 阶段循环，已在 2026-06-21 简化为单 `EXECUTE + VERIFY` 阶段。下列文档保留作为决策历史。

| 文档 | 原版本 | 主题 |
|------|--------|------|
| [core-loop-README.md](./core-loop-README.md) | v1.8.0 | Core Loop 总览 |
| [core-loop-20260617-seven-phase.md](./core-loop-20260617-seven-phase.md) | v1.8.0 | 七阶段循环图 |
| [core-loop-20260617-effort-level.md](./core-loop-20260617-effort-level.md) | v1.7.0 | Effort Level 路由（简单任务走压缩路径） |
| [core-loop-20260617-context.md](./core-loop-20260617-context.md) | v1.8.0 | 上下文管理（Memory Recall 机制） |
| [core-loop-20260617-exception.md](./core-loop-20260617-exception.md) | v1.8.0 | 异常处理矩阵 |
| [core-loop-20260617-interview.md](./core-loop-20260617-interview.md) | v1.8.0 | Interview 与反向拷问机制 |
| [core-loop-20260617-multi-agent.md](./core-loop-20260617-multi-agent.md) | v2.0.0 | 多 Agent 协调 + Task 生命周期 |

### Superpowers 工具链提案（2026-06-23）

| 文档 | 状态 | 归档原因 |
|------|------|---------|
| [superpowers-20260623-core-loop-verify-design.md](./superpowers-20260623-core-loop-verify-design.md) | 草稿 | Core Loop 已重新设计为单 EXECUTE + VERIFY，未采用 superpowers 工具链 |
| [superpowers-20260623-core-loop-verify-plan.md](./superpowers-20260623-core-loop-verify-plan.md) | 草稿 | 同上 |

### 模块设计

| 文档 | 原版本 | 归档原因 |
|------|--------|---------|
| [audit-module.md](./audit-module.md) | v1.0.0 (2026-06-17) | 审计模块在 v0.3.0 已被拆分/合并到 `tools/` 和 `security/` |

### TUI 历史

| 文档 | 日期 | 归档原因 |
|------|------|---------|
| [20260617-tui-review.md](./20260617-tui-review.md) | 2026-06-17 | TUI 初版代码审查报告（5 项问题已全部修复，参见 [modules/tui.md](../modules/tui.md)） |

---

## 相关链接

- 仓库根 [README.md](../../README.md) — 用户面向的项目介绍
- 活跃设计 [`docs/README.md`](../README.md)
- 已完成计划 [`../plans/archive/README.md`](../plans/archive/README.md)
