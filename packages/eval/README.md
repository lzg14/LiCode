# packages/eval

智能增强计划 v2 的 eval 基准框架（§7）。用于：
- 跑标准化 query 任务
- A/B 对比（有/无 M）
- 自动生成报告
- CI 集成

## 用法

```bash
# 列出现有 scenarios
bun run packages/eval/index.ts list

# 跑（mock 模式，写报告到 ./eval-results/）
bun run packages/eval/index.ts run

# A/B 对比两个 JSON 结果
bun run packages/eval/index.ts compare ./eval-results/reports/2026-07-05.json ./eval-results/reports/2026-07-06-intelligence.json
```

## 状态

**v0.4.1 spike** — 仅 mock 实现，返回占位 RunResult。
完整集成（实际跑 licode agent）在 **v0.4.5 Phase 3** 实施。

## 详细设计

`docs/plans/intelligence-enhancement-plan.md` §7
