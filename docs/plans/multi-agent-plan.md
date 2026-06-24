# 多 Agent 支持实施计划

**目标**：在 licode 中实现简化的 subagent 并行执行能力，一个任务可同时派给多个子 agent 独立工作。

**日期**：2026-06-24

## 步骤

- [x] Step 1: 设计 SubagentManager 接口，写入 `packages/core/subagent.ts`
  - verify: `bunx tsc --noEmit --skipLibCheck` 无错误 ✅

- [x] Step 2: 在 `packages/core/types.ts` 中补充 SubagentConfig 和相关类型
  - verify: 类型检查通过 ✅

- [x] Step 3: 实现 `SubagentManager.spawn()` — 创建子 agent 执行任务
  - verify: `bun test packages/core/__tests__/subagent.test.ts` 通过 ✅

- [x] Step 4: 实现 `SubagentManager.runMultiple()` — 并发控制运行多个子 agent
  - verify: `bun test packages/core/__tests__/subagent.test.ts` 并发测试通过 ✅

- [x] Step 5: 在 `execute.ts` 中添加 `runSubagent()` 工具，供 LLM 调用
  - verify: LLM 可通过 tool_call 调用 subagent，结果正确返回 ✅

- [x] Step 6: 导出类型和接口，更新 `packages/core/index.ts`
  - verify: `import { SubagentManager } from "licode/core"` 可用 ✅

## 不做什么

- 不实现 MiMo Code 的 Effect/Fiber 并发模型（太重）
- 不实现 Inbox 通知机制（先用 callback/结果返回）
- 不实现 TaskRegistry 任务跟踪（第一版只做简单结果聚合）
- 不实现 fork session（第一版子 agent 共享父 session 的消息上下文）
