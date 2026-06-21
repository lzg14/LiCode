# 清理 + 文档 + 版本号 实施计划

**目标**：删除死代码、修正 CHANGELOG/README 与实际功能一致、版本号统一 0.2.0

**日期**：2026-06-21

---

## 步骤

- [ ] **Step 1: 版本号统一 0.1.0 → 0.2.0**
  - 改 3 处：
    - `packages/tui/component/sidebar.tsx:8` — `VERSION = "0.1.0"` → `"0.2.0"`
    - `packages/tools/builtin.ts:378` — `User-Agent: 'Licode/0.1.0'` → `'Licode/0.2.0'`
    - `packages/integration/mcp.ts:63` — `version: '0.1.0'` → `'0.2.0'`
  - verify: `grep -n "0.1.0" packages/` 无匹配

- [ ] **Step 2: 删除死代码（源文件）**
  - `packages/integration/database.ts`（251 行，无人 import）
  - `packages/integration/mcp-server.ts`（250 行，mcp.ts 用直接连接不用这个）
  - `packages/integration/mcp-tools.ts`（177 行，同上）
  - `packages/integration/notes.ts`（200 行，Obsidian 笔记集成未用）
  - `packages/integration/notes-obsidian.ts`（327 行，同上）
  - `packages/memory/fts5.ts`（96 行，memory.ts 自行处理 FTS5）
  - `packages/memory/recall.ts`（12 行，从未被调用）
  - `packages/tui/component/prompt/autocomplete.tsx`（41 行，prompt/index.tsx 用自己的内联逻辑）
  - verify: `bunx tsc --noEmit --skipLibCheck` 0 error

- [ ] **Step 3: 删除死代码测试文件**
  - `packages/integration/__tests__/mcp-server.test.ts`（142 行）
  - `packages/integration/__tests__/mcp-tools.test.ts`（125 行）
  - `packages/integration/__tests__/notes.test.ts`（118 行）
  - `packages/integration/__tests__/notes-obsidian.test.ts`（144 行）
  - verify: `bun test` 不影响现有测试结果

- [ ] **Step 4: 修正 CHANGELOG.md**
  - `[0.2.0]` 移除三处虚假/不准确声明：
    - "Workflow 模板：coding / research / review"（早已被删除，列为"新增"是错的）
    - "危险命令二次确认" → 改为"危险命令直接拒绝执行"
    - "应用补丁工具：从简陋重写..."（保留，但移动到"修复"类）
  - `[Unreleased]` 加一条清理记录
  - verify: read 文件确认内容正确

- [ ] **Step 5: 更新 README.md**
  - 与 `docs/plans/productization-plan.md` 的当前已完成功能对齐
  - 删除 README 中不存在的功能（如 MCP 集成实际上存在，但只列已实现的）
  - 重新评估每个 feature 的实际状态
  - verify: README 声明与代码实际功能一致

- [ ] **Step 6: 归档已完成 plan 文档**
  - 以下计划已完成，移至 `docs/plans/archive/`：
    - `help-command.md`（已实现）
    - `security-config-wiring.md`（已实现）
    - `security-test-coverage.md`（已实现）
    - `thinking-display-refactor.md`（已实现）
  - 以下保留（未完成或待办）：
    - `shortcuts-test-coverage.md`（未实施）
    - `productization-plan.md`（阶段二-六未开始）
    - `roadmap.md`（仍有未完成项）
  - verify: `docs/plans/` 只保留未完成的计划

- [ ] **Step 7: 验证**
  - `bunx tsc --noEmit --skipLibCheck` → 0 error
  - `bun test` → 全部通过
  - verify: 两项均通过

---

## 不做什么

| 项 | 原因 |
|---|---|
| 不改 barrel index.ts | 标准 ESM 导出习惯，未来可能被 import |
| 不改 packages/security/ 的 getDefaultDeniedPaths DRY | 需更谨慎的重构，本轮聚焦清理而非重构 |
| 不改工具注册逻辑 | builtin.ts 所有工具都在用，只是类型定义落后 |
| 不伤现有测试 | 删除的测试文件只测死代码，不影响覆盖率 |
