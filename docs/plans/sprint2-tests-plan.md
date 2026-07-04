# Sprint 2 测试补充计划

**目标**：补充 tools 包和 tui 组件的测试覆盖

**日期**：2026-07-04

## 步骤

### 阶段一：tools 包 P0 工具测试

- [ ] Step 1: 补充 grep 工具测试
  - verify: `bun test packages/tools/__tests__/builtin.test.ts` 通过

- [ ] Step 2: 补充 git 系列工具测试（git_status、git_diff、git_log）
  - verify: 测试用例覆盖基本 git 操作

- [ ] Step 3: 补充 webfetch 工具测试
  - verify: 测试 URL 获取功能

- [ ] Step 4: 补充 todo_write/todo_read 工具测试
  - verify: 测试 todo 创建和读取

- [ ] Step 5: 补充 apply_patch 工具测试
  - verify: 测试 JSON patch 操作

### 阶段二：tui 组件测试

- [ ] Step 6: 创建 sidebar 组件测试
  - verify: `bun test packages/tui/component/__tests__/sidebar.test.tsx` 通过

- [ ] Step 7: 创建 message-list 组件测试
  - verify: `bun test packages/tui/component/__tests__/message-list.test.tsx` 通过

### 阶段三：P2 优化项

- [ ] Step 8: 添加 .editorconfig
  - verify: 文件存在且格式正确

- [ ] Step 9: 清理 tsconfig.json（删除 customConditions）
  - verify: `bunx tsc --noEmit --skipLibCheck` 通过

- [ ] Step 10: 修复 DANGEROUS_PATTERNS 的 g 标志问题
  - verify: 正则表达式测试通过

## 不做什么

- 不测试网络依赖的工具（websearch 已有测试）
- 不测试 Excel 工具（需要特殊文件）
- 不测试 database_query（需要 SQLite 文件）

## 验证

完成后运行：
- `bun test packages/tools` — tools 测试
- `bun test packages/tui` — tui 测试
- `bunx tsc --noEmit --skipLibCheck` — 类型检查
