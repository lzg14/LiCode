# licode 质量改进实施计划

**目标**：提升测试覆盖、清理依赖、同步文档，使项目更健壮可维护

**日期**：2026-08-01

---

## 背景

基于代码审查，以下问题需要处理：
- tools 包 34 个工具只有 7 个测试文件，覆盖不足
- tui 组件层 0 测试，流式/折叠/快捷键无回归保护
- simple-git 依赖可移除（改用 exec）
- CHANGELOG.md 有重复条目需清理

**已完成的（无需再做）**：
- ✅ Memory scope 判定 bug — 已用精确匹配 `dir === globalDir`
- ✅ reasoning parts 提取 — `session-compactor.ts:394` 已处理
- ✅ DANGEROUS_PATTERNS g 标志 — 当前正则无 g 标志问题
- ✅ CI/CD + LICENSE — 已配置

---

## 步骤

### Phase 1: 测试覆盖提升（2-3 天）

- [ ] **Step 1.1: 扩展 tools P0 工具测试**
  - 新增 `packages/tools/__tests__/glob.test.ts`
  - 扩展 `packages/tools/__tests__/bash.test.ts` 增加更多边界场景
  - 扩展 `packages/tools/__tests__/read.test.ts` 覆盖图片读取
  - verify: `bun test packages/tools` 全绿

- [ ] **Step 1.2: 新增 tools P1 工具测试**
  - 新增 `packages/tools/__tests__/git.test.ts`（git 操作工具）
  - 新增 `packages/tools/__tests__/shell.test.ts`（shell/stat 工具）
  - 新增 `packages/tools/__tests__/todo.test.ts`（规划工具）
  - verify: `bun test packages/tools` 覆盖 ≥ 50%

- [ ] **Step 1.3: 抽取 tui 纯函数测试**
  - 扩展 `packages/tui/context/__tests__/context.test.ts` 覆盖更多 utility
  - 新增 `packages/tui/util/__tests__/format.test.ts`（如有格式化函数）
  - verify: `bun test packages/tui` 覆盖提升

### Phase 2: 依赖清理（0.5 天）

- [ ] **Step 2.1: 移除 simple-git 依赖**
  - 修改 `packages/integration/git.ts` 改用 `exec('git ...')` 替代 simple-git SDK
  - 更新 `packages/integration/__tests__/git.test.ts` 适配新实现
  - verify: `bun test packages/integration` 全绿

- [ ] **Step 2.2: 清理 package.json**
  - 移除 `simple-git` 依赖
  - verify: `bun install` 无报错，`bun test` 全绿

### Phase 3: 文档同步（0.5 天）

- [ ] **Step 3.1: 清理 CHANGELOG.md**
  - 删除 `[0.4.0]` 和 `[0.3.0]` 之间的重复条目
  - 整理格式，确保每个版本条目唯一
  - verify: `grep -c "### 测试" CHANGELOG.md` 不应有重复标题

- [ ] **Step 3.2: 更新 README.md**
  - 确认"核心特性"列表与代码一致
  - 确认"技术栈"表格准确
  - verify: 手动检查 README 与 packages/ 目录对应

### Phase 4: 验证（1 天）

- [ ] **Step 4.1: 全量测试**
  - verify: `bun test` 全绿

- [ ] **Step 4.2: 类型检查**
  - verify: `bunx tsc --noEmit --skipLibCheck` 0 error

- [ ] **Step 4.3: 构建验证**
  - verify: `bun run build` 成功

---

## 不做什么

| 项 | 原因 |
|---|---|
| TUI 组件层完整测试 | SolidJS + opentui setup 复杂，本期只测纯函数 |
| 移除 `@types/better-sqlite3` | 还在 devDependencies，可能有用 |
| 修改 session-compactor | reasoning parts 已处理 |
| 修改 memory scope | 已修复为精确匹配 |
| 添加 .editorconfig | 非核心，优先级低 |

---

## 涉及文件

### 新建
- `packages/tools/__tests__/glob.test.ts`
- `packages/tools/__tests__/git.test.ts`
- `packages/tools/__tests__/shell.test.ts`
- `packages/tools/__tests__/todo.test.ts`
- `packages/tui/util/__tests__/format.test.ts`（如需要）

### 修改
- `packages/tools/__tests__/bash.test.ts`（扩展）
- `packages/tools/__tests__/read.test.ts`（扩展）
- `packages/integration/git.ts`（移除 simple-git）
- `packages/integration/__tests__/git.test.ts`（适配）
- `package.json`（移除 simple-git）
- `CHANGELOG.md`（清理重复）
- `README.md`（确认一致性）

---

## 验收标准

1. ✅ `bun test` 全绿
2. ✅ `bunx tsc --noEmit --skipLibCheck` 0 error
3. ✅ `bun run build` 成功
4. ✅ tools 包测试覆盖 ≥ 50%
5. ✅ simple-git 依赖已移除
6. ✅ CHANGELOG.md 无重复条目
7. ✅ README.md 与代码功能一致

---

## 风险

| 风险 | 缓解 |
|---|---|
| 移除 simple-git 后 git 操作失败 | 保留原有测试覆盖，逐步替换 |
| 新测试不稳定 | 先写 mock，避免真实文件系统操作 |
| CHANGELOG 清理破坏历史 | 只删除明确的重复条目 |

---

## 相关文档

| 文档 | 状态 |
|---|---|
| `docs/plans/production-gaps-2026-q3.md` | ⏸️ 仍有效（P1/P2 可参考） |
| `CHANGELOG.md` | 完工后加 Unreleased 条目 |
