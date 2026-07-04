# licode 生产就绪提升计划

**目标**：从当前 6.5/10 提升到 9/10 生产可用

**日期**：2026-07-04

---

## Sprint 0：修挂掉的测试 + 低 hanging fruit（30 分钟）

- [ ] Step 0.1: 修复 session-recovery 测试（doStream mock 未对齐 streamText 路径）
  - verify: `bun test packages/core/__tests__/session-recovery.test.ts` 通过

- [ ] Step 0.2: 加 `.gitattributes` 统一行尾，消除 CRLF/LF 冲突
  - verify: `cat .gitattributes` 存在且合理

- [ ] Step 0.3: CI 锁 bun 版本 + 补 `package.json` 缺字段
  - verify: `.github/workflows/ci.yml` 中 `bun-version` 为固定版本
  - verify: `package.json` 有 `packageManager`、`scripts.lint`、`scripts.typecheck`

## Sprint 1：CI 加固（1 小时）

- [ ] Step 1.1: CI 加 lint job
  - verify: `.github/workflows/ci.yml` 有 lint step
  - verify: `bun run lint` 通过

- [ ] Step 1.2: 统一 vitest/bun test runner
  - verify: `package.json` test 脚本用 `bun test`

## Sprint 2：any 治理（1 天）

- [ ] Step 2.1: 治理 `core/phases/execute.ts` 17 个 any
  - verify: execute.ts 中 any ≤ 5
  - verify: `bun test` 全绿

- [ ] Step 2.2: 治理 `session/session.ts` 16 个 any
  - verify: session.ts 中 any ≤ 5
  - verify: `bun test` 全绿

- [ ] Step 2.3: 治理其余热点文件（session-compactor 9、subagent 9、app.tsx 7 等）
  - verify: 全仓 any ≤ 20
  - verify: `bun test` 全绿

## Sprint 3：God File 拆分（1-2 天）

- [ ] Step 3.1: 拆分 `tools/builtin.ts`（914 行）
  - verify: builtin/ 目录下每个文件 < 200 行
  - verify: 对外 API 不变，`bun test` 全绿

- [ ] Step 3.2: 拆分 `session/session.ts`（625 行）
  - verify: session/ 目录下每个文件 < 200 行
  - verify: `bun test` 全绿

- [ ] Step 3.3: 拆分 `core/phases/execute.ts`（595 行）
  - verify: execute/ 目录下每个文件 < 200 行
  - verify: `bun test` 全绿

## Sprint 4：补测试 + 发布流程（1 天）

- [ ] Step 4.1: CLI 包补 smoke 测试
  - verify: `packages/cli/__tests__/` 存在，测试数 ≥ 5

- [ ] Step 4.2: TUI context 核心路径补测试
  - verify: `packages/tui/context/__tests__/` 存在，测试数 ≥ 5

- [ ] Step 4.3: 加 release workflow / 发布文档
  - verify: `.github/workflows/release.yml` 或 `RELEASING.md` 存在

## 不做什么

- ❌ 不改 TUI 组件测试（投入产出比低）
- ❌ 不重写现有功能（只拆分和重构 bad smell）
- ❌ 不加 husky/pre-commit 钩子（CI 门禁够用）
- ❌ 不加 CONTRIBUTING.md / Issue 模板（单人多库项目不需要）
- ❌ 不换 `chalk` → `picocolors`（纯 style 问题）
