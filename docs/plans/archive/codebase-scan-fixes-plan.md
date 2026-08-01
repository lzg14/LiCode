# 代码扫描问题修复计划

**目标**：修复代码扫描发现的安全漏洞、死代码、类型问题和架构不一致

**日期**：2026-07-04

## 步骤

### 阶段一：安全修复（HIGH优先级）

- [ ] Step 1: 修复命令注入漏洞
  - 将 `builtin.ts` 中 `process_list`、`install_deps`、`gh`、`git_diff`、`open_explorer`、`open_url`、`code_search` 等工具的 `execAsync` 字符串拼接改为 `execFileAsync` + 数组参数
  - verify: `bunx tsc --noEmit --skipLibCheck` 通过，无编译错误

- [ ] Step 2: 修复路径遍历漏洞
  - 在 `packages/security/index.ts` 的 `checkPath` 方法中添加 `path.resolve()` 规范化
  - verify: 构造 `../../etc/passwd` 路径测试被拒绝

- [ ] Step 3: 修复敏感信息泄露
  - 修改 `env_vars` 工具，当 `name` 未指定时过滤敏感环境变量（API_KEY、TOKEN、SECRET、PASSWORD）
  - verify: 调用 `env_vars` 无参数时不返回含密钥的变量

- [ ] Step 4: 防止 API Key 持久化
  - 修改 `packages/config/loader.ts` 的 `save()` 方法，序列化前过滤 `apiKey` 字段
  - verify: `save()` 后检查输出文件不包含 apiKey

### 阶段二：死代码清理

- [ ] Step 5: 删除未使用的文件
  - 删除以下 4 个文件：
    - `packages/core/review.ts` (212行)
    - `packages/core/interview.ts` (164行)
    - `packages/security/permissions.ts` (18行)
    - `packages/security/safe-boundary.ts` (35行)
  - verify: `bunx tsc --noEmit --skipLibCheck` 通过，无编译错误

- [ ] Step 6: 清理未使用的导出
  - 删除或标记以下未使用的导出：
    - `config/defaults.ts`: `DEV_CONFIG`、`PROD_CONFIG`、`getEnvironmentConfig`、`mergeWithDefaults`
    - `config/validator.ts`: 整个 `ConfigValidator` 类
    - `config/external.ts`: `discoverExternalSources()`
    - `llm/auth.ts`: `AuthManager` 类
    - `skills/executor.ts`: 整个 `SkillExecutor` 类
    - `skills/hot-reload.ts`: 整个 `SkillHotReload` 类
  - verify: `bunx tsc --noEmit --skipLibCheck` 通过

- [ ] Step 7: 移除未使用的依赖
  - 从 `package.json` 移除：
    - `chalk` (^5.3.0)
    - `@ai-sdk/provider` (^3.0.10)
    - `zod-to-json-schema` (^3.25.2)
  - verify: `bun install` 成功，`bunx tsc --noEmit --skipLibCheck` 通过

### 阶段三：类型系统修复

- [ ] Step 8: 更新 ToolName 类型
  - 更新 `packages/tools/types.ts` 的 `ToolName` 联合类型，覆盖全部约 30 个工具
  - verify: TypeScript 编译通过，无类型错误

- [ ] Step 9: 合并 SecurityConfig 重复定义
  - 删除 `packages/core/types.ts` 中的简化版 `SecurityConfig`
  - 统一使用 `packages/security/index.ts` 的完整定义
  - verify: `bunx tsc --noEmit --skipLibCheck` 通过

- [ ] Step 10: 消除 getDefaultDeniedPaths 重复
  - 删除 `packages/security/merge.ts` 中的重复实现
  - 统一调用 `packages/security/index.ts` 中的版本
  - verify: `bunx tsc --noEmit --skipLibCheck` 通过

### 阶段四：架构一致性修复

- [ ] Step 11: 修复 zodToJsonSchema 重复
  - 将 `packages/core/phases/execute.ts` 和 `packages/core/subagent.ts` 中的重复函数提取到共享模块
  - verify: `bunx tsc --noEmit --skipLibCheck` 通过

- [ ] Step 12: 清理 Projector 残留阶段名
  - 更新 `packages/core/projector.ts` 的 `phaseNames` 映射，移除已删除的阶段（OBSERVE、THINK、PLAN、BUILD、LEARN）
  - verify: 检查映射只包含 EXECUTE、VERIFY、DONE

### 阶段五：文档更新

- [ ] Step 13: 更新 CLAUDE.md
  - 修正 Phase 类型：`'EXECUTE' | 'VERIFY' | 'DONE'`
  - 修正压缩阈值：1000 条
  - 修正记忆系统描述：基于文件系统，非 FTS5
  - 更新计划文档位置：标记已归档的文档
  - verify: 检查文档与代码一致

- [ ] Step 14: 更新 README.md
  - 补全斜杠命令：添加 `/help` 和 `/loop`
  - 修正记忆系统描述
  - verify: 检查文档与代码一致

- [ ] Step 15: 更新 CHANGELOG.md
  - 在 `[Unreleased]` 部分添加本次修复记录
  - verify: CHANGELOG 格式正确

## 不做什么

- 不修改核心业务逻辑（只修复安全、类型、死代码问题）
- 不重构 TUI 组件（只清理直接引用的死代码）
- 不添加新功能（只修复现有问题）
- 不修改测试文件（除非死代码清理导致测试失败）

## 执行策略

1. **阶段一（安全修复）**：使用 `parallel-agents` 并行执行 Step 1-4
2. **阶段二（死代码清理）**：串行执行 Step 5-7（有依赖关系）
3. **阶段三（类型修复）**：使用 `parallel-agents` 并行执行 Step 8-10
4. **阶段四（架构修复）**：串行执行 Step 11-12
5. **阶段五（文档更新）**：使用 `parallel-agents` 并行执行 Step 13-15

## 验证

完成后运行：
- `bunx tsc --noEmit --skipLibCheck` — 类型检查
- `bun test` — 单元测试
- `bun run build` — 构建验证