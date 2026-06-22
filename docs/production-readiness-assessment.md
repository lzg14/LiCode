# licode 生产可用性评估报告

**日期**：2026-07-15
**评估范围**：基于当前代码（v0.2.0）全面审视各模块成熟度
**核心问题**：离生产可用还有多少差距？

---

## 总体评分

| 维度 | 评分 | 状态 |
|------|------|------|
| **安全层** | ⭐⭐⭐⭐☆ 8/10 | 核心完备，配置联动待补 |
| **核心循环 (Core Loop)** | ⭐⭐⭐⭐☆ 8/10 | 稳定，但缺少错误恢复策略 |
| **工具系统** | ⭐⭐⭐⭐⭐ 9/10 | 34 个工具，完整覆盖编码场景 |
| **会话持久化** | ⭐⭐⭐⭐☆ 8/10 | SQLite + 压缩 + checkpoint，可靠 |
| **TUI** | ⭐⭐⭐⭐☆ 7/10 | 功能全，但首次启动有布局闪烁 |
| **LLM 集成** | ⭐⭐⭐⭐☆ 7/10 | 4 个 provider，但 fallback/重试不足 |
| **安全配置 (security)** | ⭐⭐⭐☆☆ 5/10 | 白名单不与配置联动，`bun` 遗漏 |
| **技能系统** | ⭐⭐⭐☆☆ 5/10 | 基础加载可用，无测试覆盖 |
| **记忆系统** | ⭐⭐⭐☆☆ 5/10 | FTS5 基础功能，无测试 |
| **测试覆盖** | ⭐⭐⭐☆☆ 5/10 | 28 个测试文件，关键模块缺测 |
| **CI/CD** | ⭐☆☆☆☆ 1/10 | 无任何 CI 配置 |
| **错误处理** | ⭐⭐⭐☆☆ 5/10 | try-catch 散落，无统一错误边界 |
| **文档** | ⭐⭐⭐⭐☆ 7/10 | README/CLAUDE/CHANGELOG 齐全，plans 完善 |

**总体：⭐⭐⭐⭐ 6.5/10 — 个人/小团队可用，生产环境还差一截**

---

## 一、已完成情况（对照产品化计划）

原 `docs/plans/productization-plan.md` 六阶段计划，实际完成度：

### ✅ 阶段零：清理工作区（已完成）
七阶段 phase 文件已删除，Phase 类型收窄为 `EXECUTE | DONE`。

### ✅ 阶段一：P0 缺陷修复（基本完成）
| 项目 | 状态 | 说明 |
|------|------|------|
| 1.1 安全层接入工具执行 | ✅ 完成 | `registry.ts` 有 `preExecuteHook`，bash 走白名单 + 危险模式检查 |
| 1.2 规划工具 (todo) | ✅ 完成 | `todo_write` / `todo_read` 已实现，TUI 侧栏实时渲染 |
| 1.3 危险命令二次确认 | ✅ 完成 | `checkDangerousPattern` 覆盖 rm -rf / sudo / curl\|sh 等 |

### ✅ 阶段二：体验增强（基本完成）
| 项目 | 状态 | 说明 |
|------|------|------|
| 2.1 Diff 预览 | ✅ 完成 | `write`/`edit` 工具返回 unified diff |
| 2.2 工具结果截断 | ✅ 完成 | `truncate.ts` 按字符数截断 |

### ✅ 阶段三：上下文管理（完成）
| 项目 | 状态 | 说明 |
|------|------|------|
| 3.1 `.licode.md` 加载 | ✅ 完成 | 项目级 + 全局两级合并 |
| 3.2 上下文窗口预警 | ✅ 完成 | 侧栏 >80% 黄、>95% 红 |

### ✅ 阶段四：MCP 生态（完成）
`packages/integration/mcp.ts` + `mcp-server.ts` + `mcp-tools.ts` 完整实现。

### ✅ 阶段五：Workflow 简化（完成）
七阶段引擎已删除，改为 system prompt 模板。

### ✅ 阶段六：测试与文档同步（部分完成）
README/CHANGELOG 已更新。测试覆盖仍有缺口。

**结论：产品化计划中列举的 90% 功能已实现。**

---

## 二、当前存在的关键问题

### 🔴 P0：必修项（影响使用安全或核心功能）

#### 1. `bun` 不在 bash 白名单中
- **位置**：`packages/security/whitelist.ts` → `BASE_WHITELIST`
- **问题**：`bun` 作为项目运行时，竟然不在白名单里。`npm`、`npx`、`pnpm` 都在。
- **影响**：LLM 无法执行 `bun install`、`bun test`、`bun run` 等命令。
- **修复**：在 `BASE_WHITELIST` 加 `'bun'`。

#### 2. 安全配置不与用户配置联动
- **位置**：`packages/security/whitelist.ts` + `packages/config/schema.ts`
- **问题**：`licode.config.json` 里的 `security.commandWhitelist`、`allowedPaths`、`deniedPaths` 虽然定义了 schema，但**没有实际接入到安全层的检查逻辑**。安全层用的是硬编码的 `DEFAULT_WHITELIST` 和 `BLOCKED_COMMANDS`。
- **影响**：用户无法通过配置文件自定义白名单 / 放行路径。
- **修复**：`getSecurityLayer()` 需要从配置加载自定义规则。

#### 3. 无 CI/CD
- **问题**：没有任何 GitHub Actions / CI 配置。每次提交无法自动跑测试和类型检查。
- **影响**：多人协作时，破坏性变更无法被自动检测。
- **修复**：加 `.github/workflows/ci.yml`，跑 `bun install && bunx tsc --noEmit --skipLibCheck && bun test`。

### 🟡 P1：重要项（影响使用体验或可靠性）

#### 4. Core Loop 缺少错误恢复策略
- **位置**：`packages/core/loop.ts`
- **问题**：`run()` 方法中，LLM 调用失败、工具执行异常、session 持久化失败等都散布在 try-catch 中，没有统一的错误恢复策略（如重试、回退、降级）。
- **影响**：网络波动导致 LLM 调用失败时，用户会看到一个错误消息，但不知道能否重试。

#### 5. 技能系统无测试
- **位置**：`packages/skills/` 整个目录
- **问题**：5 个文件（executor / hot-reload / loader / registry / self-improve），0 个测试。
- **影响**：技能加载逻辑出错时无法被自动发现。

#### 6. 记忆系统测试薄弱
- **位置**：`packages/memory/`
- **问题**：只有 1 个测试文件（`memory.test.ts`），`fts5.ts`、`recall.ts`、`schema.ts` 完全没有测试。
- **影响**：FTS5 搜索准确性、recall 召回逻辑无保障。

#### 7. 首次启动 TUI 布局闪烁
- **位置**：`packages/tui/app.tsx`
- **问题**：CLAUDE.md 提到"TUI 首次 resize 问题，app.tsx 有 setTimeout 兜底"。
- **影响**：首次启动时用户看到短暂的黑屏/布局错乱。

#### 8. Provider 切换缺少 fallback
- **位置**：`packages/llm/provider.ts`
- **问题**：只有一个 provider 配置，没有 fallback 链。如果 primary provider 挂了，不会自动切换到 backup。
- **影响**：Anthropic 断服时 licode 直接不可用。

### 🔵 P2：优化项（锦上添花）

#### 9. 配置校验缺失
- **位置**：`packages/config/loader.ts`
- **问题**：启动时不校验配置文件完整性，坏文件仅 `console.warn`。
- **修复**：增加启动时 schema 校验，坏配置给出明确的错误信息。

#### 10. apply_patch 工具 diff 算法简陋
- **位置**：`packages/tools/builtin.ts` → `write` / `edit` 工具的 diff 逻辑
- **问题**：自己实现的简单逐行比较，不是真正的 unified diff（不处理上下文行）。
- **影响**：diff 在复杂编辑场景下可能不准。

#### 11. 项目入口散乱
- **问题**：`packages/cli/index.ts` 是 CLI 入口，但 `package.json` 的 `"cli"` 和 `"dev"` 脚本都指向它。同时又有 `"main": "dist/index.js"`。
- **影响**：模块解析路径不统一。

#### 12. 工具描述与实现不完全一致
- **位置**：`packages/tools/builtin.ts`
- **问题**：例如 `codesearch` 的工具描述说"使用 ripgrep 搜索代码"，但如果没有 rg 会静默失败（没有 fallback）；`lint` 工具说"自动检测 eslint/ruff/biome"，但尝试顺序不确定。
- **影响**：LLM 可能基于描述假设某行为，但实际行为不同。

---

## 三、各模块详细评估

### 3.1 安全层 (packages/security/)

```
文件：5 个（index, merge, permission, permissions, safe-boundary, sensitive, whitelist）
测试：3 个（factory, merge, permission）
```

| 方面 | 评分 | 说明 |
|------|------|------|
| 命令白名单 | 7/10 | 基础白名单完备，但缺少 `bun`；不与配置联动 |
| 路径检查 | 8/10 | `deniedPaths` 概念清晰，MCP 工具也走路径检查 |
| 危险命令检测 | 8/10 | 覆盖 rm -rf / sudo / curl\|sh / chmod 777 等 |
| 权限系统 (PermissionManager) | 7/10 | allow/deny/ask 三级设计合理，但生产未使用 `ask` |
| 敏感信息 redact | 8/10 | devLogger 有 redact 机制，API key 自动遮蔽 |

**主要风险**：配置不联动，用户无法自定义安全策略。

### 3.2 核心循环 (packages/core/)

```
文件：12 个（loop, execute, checkpoint, compaction, dev-logger, interview, projector, review, session-compactor, perf, types）
测试：4 个（checkpoint, dev-logger-redact, perf, session-recovery）
```

| 方面 | 评分 | 说明 |
|------|------|------|
| Core Loop 主体 | 7/10 | 流程清晰，但错误恢复薄弱 |
| 执行阶段 (execute) | 8/10 | 工具循环完善，`findValidStart` 处理 orphan tool-call |
| Checkpoint 恢复 | 8/10 | 断点续传实现正确 |
| 历史压缩 | 7/10 | 30/100 条阈值合理，但压缩质量无保障（依赖 LLM） |
| 性能埋点 (perf) | 6/10 | 有 Timer 类，但数据没有可视化或持久化分析 |

**主要风险**：LLM 调用失败时用户只能重新开始，没有重试/降级。

### 3.3 工具系统 (packages/tools/)

```
文件：6 个（builtin, context, index, registry, truncate, types）
测试：1 个（builtin.test.ts）
```

| 方面 | 评分 | 说明 |
|------|------|------|
| 工具覆盖度 | 9/10 | 34 个工具，涵盖文件/搜索/Git/Web/开发/数据库/Excel/图片 |
| 注册机制 | 9/10 | `ToolRegistry` 设计清晰，支持 pre-execute hook |
| 输入校验 | 8/10 | Zod schema 校验，错误信息友好 |
| 输出截断 | 7/10 | 有 `truncateOutput`，但不是按 token 截断 |
| 测试覆盖 | 3/10 | 只有 builtin.test.ts 一个测试文件 |

**主要风险**：34 个工具只有 1 个测试文件，新增工具可能破坏现有行为。

### 3.4 会话管理 (packages/session/)

```
文件：6 个（session, checkpoint, checkpoint-paths, memory, prompt）
测试：1 个（session.test.ts）
```

| 方面 | 评分 | 说明 |
|------|------|------|
| 持久化 | 8/10 | SQLite，支持 tool-call/tool-result parts |
| 历史消息管理 | 8/10 | 自动压缩、配对校验、摘要注入 |
| 跨启动恢复 | 7/10 | 最近 session 可恢复，但多 session 管理弱 |
| 测试覆盖 | 5/10 | 只有 1 个测试 |

### 3.5 TUI (packages/tui/)

```
文件：19+ 个（routes/home, component/*, context/*, ui/*, util/*）
测试：3 个（help-content, thinking-display, shortcuts）
```

| 方面 | 评分 | 说明 |
|------|------|------|
| 页面布局 | 8/10 | 主界面 + 侧栏 + 模型选择 + 帮助面板 |
| 消息列表 | 7/10 | scrollbox 带 sticky bottom，但长对话性能未知 |
| 输入框 | 8/10 | 完整快捷键、斜杠菜单、粘贴图片 |
| 快捷键系统 | 8/10 | 全局 + 上下文快捷键，VS Code 对齐 |
| 测试覆盖 | 3/10 | 组件层（sidebar/message-list/spinner）无测试 |

### 3.6 LLM 集成 (packages/llm/)

```
文件：6 个（provider, catalog, cost, auth, types）
测试：0 个
```

| 方面 | 评分 | 说明 |
|------|------|------|
| Provider 覆盖 | 7/10 | Anthropic / OpenAI / DeepSeek / MiniMax |
| 模型管理 | 6/10 | catalog 有基础数据，但没有版本管理 |
| 成本追踪 | 6/10 | `cost.ts` 有计算逻辑，但未接入 TUI |
| 测试覆盖 | 0/10 | 无任何测试 |

### 3.7 集成层 (packages/integration/)

```
文件：9 个（database, git, mcp, mcp-server, mcp-tools, notes, notes-obsidian, plugin, types）
测试：5 个
```

| 方面 | 评分 | 说明 |
|------|------|------|
| Git 集成 | 7/10 | 基础操作，缺少 rebase/stash/branch 管理 |
| MCP 集成 | 8/10 | 自动连接 + 动态注册 + 安全校验 |
| 插件系统 | 5/10 | 有 pluginManager，但只有 session:start/end 两个 hook |
| 笔记集成 | 3/10 | Obsidian 集成存在但无测试 |

### 3.8 配置系统 (packages/config/)

```
文件：6 个（defaults, external, index, loader, schema, validator）
测试：1 个（loader.test.ts）
```

| 方面 | 评分 | 说明 |
|------|------|------|
| 多层级加载 | 8/10 | project > global > Claude Code > default 优先级正确 |
| 环境变量覆盖 | 8/10 | LICODE_MODEL/PROVIDER/API_KEY 支持 |
| 热更新 | 6/10 | `watch()` 有实现但生产未启用 |
| Schema 校验 | 7/10 | Zod schema 定义完整 |

**主要风险**：`security` 配置定义了 schema 但 loader 没有校验默认值合理性。

---

## 四、与同类产品对比

| 维度 | licode | Claude Code | Cursor | Aider |
|------|--------|-------------|--------|-------|
| 安全层 | ⚠️ 基础完备，配置不联动 | ✅ 完善 | ✅ 完善 | ✅ 完善 |
| 工具系统 | ✅ 34 个工具，覆盖全 | ✅ 类似 | ✅ IDE 原生 | ⚠️ 较少 |
| TUI | ✅ SolidJS 终端 UI | ✅ 终端 UI | ❌ IDE 插件 | ✅ 终端 UI |
| 多 Provider | ✅ 4 个 | ❌ 仅 Anthropic | ✅ 多模型 | ✅ 多模型 |
| MCP 支持 | ✅ 已集成 | ✅ 已集成 | ❌ 无 | ❌ 无 |
| 记忆系统 | ⚠️ FTS5 基础 | ✅ Claude 内置 | ⚠️ 有 | ❌ 无 |
| 会话持久化 | ✅ SQLite + 压缩 | ✅ 有 | ✅ 有 | ⚠️ 有限 |
| 测试覆盖 | ⚠️ 28 个文件，30% | ❓ 未知 | ✅ 高 | ✅ 中 |
| 生产文档 | ⚠️ 有但不够 | ✅ 完善 | ✅ 完善 | ✅ 完善 |
| CI/CD | ❌ 无 | ✅ 有 | ✅ 有 | ✅ 有 |
| 安装便捷度 | ⚠️ 需手动 | ✅ 一键 | ✅ 下载即用 | ✅ pip install |
| **成熟度** | **6.5/10** | **9/10** | **8/10** | **7/10** |

---

## 五、修复优先级建议

### 立即修复（半天内）

| # | 问题 | 影响 | 预估工时 |
|---|------|------|----------|
| 1 | `bun` 加入白名单 | 当前无法执行项目命令 | 5 分钟 |
| 2 | 安全配置联动 | 用户无法自定义安全策略 | 2 小时 |
| 3 | 加 CI 配置 | 每次提交无自动检查 | 1 小时 |

### 短期修复（2-3 天）

| # | 问题 | 影响 | 预估工时 |
|---|------|------|----------|
| 4 | Core Loop 错误恢复 | LLM 调用失败不可重试 | 4 小时 |
| 5 | 技能系统加测试 | 技能加载逻辑无保障 | 2 小时 |
| 6 | 记忆系统加测试 | FTS5 召回无保障 | 2 小时 |
| 7 | TUI 首次启动闪烁 | 用户体感差 | 1 小时 |
| 8 | Provider fallback | 单点故障 | 3 小时 |

### 中期优化（1 周）

| # | 问题 | 影响 | 预估工时 |
|---|------|------|----------|
| 9 | 配置启动校验 | 坏配置静默失败 | 2 小时 |
| 10 | 工具系统全面加测试 | 34 个工具仅 1 个测试 | 2 天 |
| 11 | TUI 组件测试覆盖 | 前端逻辑无保障 | 1 天 |
| 12 | LLM provider 单元测试 | 0 测试覆盖 | 0.5 天 |

---

## 六、结论

### 当前定位：**个人/小团队可用**

licode 已经是一个**功能完整**的 terminal AI coding agent：
- 34 个工具的覆盖面超过同类产品
- 安全层（白名单 + 路径检查 + 危险命令检测）设计正确
- MCP 集成、Session 持久化、Checkpoint 恢复等基础设施扎实
- TUI 交互体验完整

### 生产环境还差什么

1. **安全配置不联动** — 用户无法自定义安全策略，这是最严重的缺陷
2. **无 CI/CD** — 无法保证每次变更不引入回归
3. **测试覆盖不足** — 28 个测试文件对于 12 个包、34 个工具来说远远不够
4. **错误恢复薄弱** — LLM 调用失败、工具异常时缺乏统一的降级策略
5. **安装体验** — 需要手动配置，没有一键安装脚本

### 如果目标是大规模使用

还需要：安装脚本/包管理器发布、文档站、错误遥测、多语言支持、无障碍访问。这些在当前阶段没有必要投入。

### 建议

**保持现状**，优先修 P0 的 3 个问题（1 天），然后根据实际使用反馈迭代。licode 的价值在于"功能全、可定制"，不需要对标 Claude Code 的 polished 体验。
