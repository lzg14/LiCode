# 代码质量提升计划

> ⚠️ **本文档部分已实施（2026-07-22 状态更新）**
>
> 原始 8 项 P0 全部已完成：
> - ✅ P0-1（tui 编译错，sidebar.tsx 引用 phase）— 已修
> - ✅ P0-2（bun 白名单）— whitelist.ts 第 4 行
> - ✅ P0-3（安全配置联动）— `packages/security/merge.ts`
> - ✅ P0-4（provider 类型统一）— `packages/llm/types.ts` 单一 source
> - ✅ P0-6（licode.config.json.example 修复）
> - ✅ P0-7（pluginManager 决策）— 已删死代码
> - ✅ P0-8（LICENSE 计划）— 进行中（见新文档 P0-2）
>
> **剩余未完成**：
> - ❌ P0-5（CI/CD）— 见新文档 [`production-gaps-2026-q3.md`](./production-gaps-2026-q3.md) P0-1
> - ⚠️ P1-1（tools/llm/skills 测试）— 见新文档 P1-1
> - ⚠️ P1-3（memory scope 修复）— 见新文档 P1-3
> - ⚠️ P1-9（reasoning parts 提取）— 见新文档 P1-4
> - ⚠️ P1-10（console.* 统一）— 已基本完成（grep 0 匹配），仍需 review
> - ⚠️ P1-12（slashItems 抽 BUILTIN_COMMANDS）— 见新文档 P2-8
> - ⚠️ P2-1/2/3/4/6/8 — 见新文档 P2 区
>
> **当前总评**：7.5/10（从 6.5/10 提升），剩余差距在新文档。

---

**目标**：基于全量扫描结果，分三档优先级修复 30+ 项代码质量问题，使 licode 从 6.5/10 提升至 8/10，达到"个人/小团队生产可用"

**日期**：2026-06-22（部分已实施）
**范围**：全项目（11 个包、34 个工具、~5000 行 TS）
**前置**：[archive/2026-07-15-assessment.md](../archive/2026-07-15-assessment.md) 的 6.5/10 评估

---

## 扫描概览

| 维度 | 当前 | 目标 |
|------|------|------|
| 编译 | ❌ sidebar.tsx 引用了已删除的 `LoopContext.phase` | ✅ tsc --noEmit 零错 |
| 安全 | ❌ `bun` 不在白名单，安全配置不联动 | ✅ 白名单完整，用户配置生效 |
| CI/CD | ❌ 无 | ✅ 跑 test + tsc + lint |
| 测试覆盖 | ⚠️ ~30% 关键路径 | ✅ 60% 关键路径 |
| 文档 | ⚠️ 缺 LICENSE/INDEX/README 链接 | ✅ 基础完整 |
| 类型一致 | ❌ `LLMConfig.provider` 漏 'deepseek'/'minimax' | ✅ 单一 source of truth |
| 错误处理 | ⚠️ 散落 console.* | ✅ 走 devLogger 统一通道 |
| 死代码 | ⚠️ pluginManager 空跑 | ✅ 移除或实现 |

**问题统计**：P0 × 8，P1 × 12，P2 × 14，合计 34 项

---

## P0：必修（影响编译/安全/可用性）

### P0-1. 修复 TUI 编译错误

**问题**：`tsc-result2.txt` 报错
```
packages/tui/component/sidebar.tsx: Property 'phase' does not exist on type 'LoopContext'.
```

Phase 字段在 0.2.0 简化时已从 `LoopContext` 删除（types.ts 只有 `EXECUTE | DONE`），但 sidebar.tsx 还在用。

**修复**：
- [Step] → verify: [打开 `packages/tui/component/sidebar.tsx`，删掉 `ctx.phase` 引用，改用 `ctx.sessionSummary` 或 `isProcessing()` 判断]
- [Step] → verify: [`bunx tsc --noEmit --skipLibCheck` 零错]

**工时**：15 分钟

---

### P0-2. `bun` 加入白名单

**问题**：`packages/security/whitelist.ts` 的 `BASE_WHITELIST` 包含 `git/npm/npx/pnpm/yarn`，但没有 `bun`。
licode 自己就是用 Bun 跑的，`bun install` / `bun test` / `bun run` 全部被安全层拦截。

**修复**：
- [Step] → verify: [在 `BASE_WHITELIST` 加上 `'bun'`、`'bunx'`，提交一个测试用例到 `packages/security/__tests__/whitelist.test.ts`]
- [Step] → verify: [手动跑 `licode` 让 LLM 执行 `bun --version` 不被拦截]

**工时**：5 分钟

---

### P0-3. 安全配置与 SecurityLayer 联动

**问题**：用户能在 `licode.config.json` 配 `security.commandWhitelist` / `allowedPaths` / `deniedPaths`，但
`getSecurityLayer()` 读的是硬编码的 `DEFAULT_WHITELIST` 和 `getDefaultDeniedPaths()`，配置完全没生效。

**修复**：
- [Step] → verify: [`packages/security/whitelist.ts` 暴露 `mergeWhitelist(default, user)` 纯函数，单元测试覆盖追加/去重/覆盖三种语义]
- [Step] → verify: [`packages/tui/app.tsx` 的 `tui()` 函数在创建 SecurityLayer 之前，把 `config.security` 传进去（参考已有的 `mergeSecurityConfig`）]
- [Step] → verify: [手测：在 `licode.config.json` 加 `"commandWhitelist": ["docker"]`，让 LLM 执行 `docker ps` 不被拦；删掉该项后被拦]

**工时**：2 小时

---

### P0-4. 统一 LLMConfig.provider 类型

**问题**：同一字段在 3 个地方定义，互不一致：
- `packages/core/types.ts` 的 `LLMConfig.provider: 'anthropic' | 'openai' | 'local'`（漏 deepseek/minimax）
- `packages/config/schema.ts` 的 `LLMConfigSchema.provider: enum(['anthropic', 'openai', 'deepseek', 'MiniMax', 'local'])`
- `packages/llm/provider.ts` 的 `createModelForProvider` 支持 4 个 provider

**修复**：
- [Step] → verify: [在 `packages/llm/types.ts` 新建 `export const PROVIDERS = ['anthropic','openai','deepseek','minimax','local'] as const` 和 `export type Provider = typeof PROVIDERS[number]`，由 `llm` 包作为单一 source of truth]
- [Step] → verify: [`core/types.ts`、`config/schema.ts` 都从 `llm/types.ts` 导入 `Provider`]
- [Step] → verify: [`bunx tsc --noEmit --skipLibCheck` 零错]

**工时**：1 小时

---

### P0-5. 加 CI/CD 配置

**问题**：项目无 `.github/workflows/`，PR 不会自动跑 test/tsc/lint。

**修复**：
- [Step] → verify: [新增 `.github/workflows/ci.yml`，matrix OS = [ubuntu, windows, macos]，跑 `bun install && bunx tsc --noEmit --skipLibCheck && bun test`]
- [Step] → verify: [在 README 顶部加 CI badge]

**工时**：1 小时

---

### P0-6. 修复 licode.config.json.example

**问题**：example 与 schema 不一致：
- example 顶级有 `mcpServers`，schema 是 `mcp.mcpServers`
- example 缺 `allowedPaths` 字段（schema 必填）

LLM 看到坏 example 会写出同样坏的配置。

**修复**：
- [Step] → verify: [按 `ConfigSchema` 重新写 example，去掉中文注释键（带 `//` 的 key 不是合法 JSON），结构对齐]
- [Step] → verify: [`node -e "JSON.parse(require('fs').readFileSync('licode.config.json.example'))"` 不报错]
- [Step] → verify: [用 `ConfigSchema.parse(exampleJSON)` 校验通过]

**工时**：30 分钟

---

### P0-7. pluginManager 决策

**问题**：`packages/core/loop.ts` 调用了
```ts
await pluginManager.emit('session:start', ctx.sessionId)
await pluginManager.emit('session:end', ctx.sessionId)
```
但 `registerBuiltinTools()` 没注册任何插件，emit 是 no-op。这要么是"占位代码"要么是"未完成的扩展点"。

**修复**（二选一）：
- 选项 A（推荐）→ verify: [删除 `packages/integration/plugin.ts`（183 行死代码），删掉 loop.ts 的 emit 调用，CHANGELOG 记 `chore: remove unused plugin system`]
- 选项 B → verify: [实现最小可用 plugin 系统：1 个示例 plugin 注入 session 事件监听，写 2 个单测]

**工时**：A 30 分钟 / B 4 小时

---

### P0-8. 补 LICENSE 文件

**问题**：README 顶部写 `MIT License`，但仓库根无 `LICENSE` 文件。

**修复**：
- [Step] → verify: [新建 `LICENSE`（标准 MIT 文本，作者填 licode 作者，年份 2026）]

**工时**：5 分钟

---

## P1：重要（影响体验/可维护性）

### P1-1. 测试覆盖补齐

**当前状态**：
| 包 | 工具/模块数 | 测试文件数 | 覆盖率 |
|----|------------|------------|--------|
| tools | 34 | 1 | 3% |
| llm | 6 | 0 | 0% |
| skills | 7 | 0 | 0% |
| tui/components | 8 | 0 | 0% |
| memory | 1 个类 | 1 | 30% |
| security | 7 个文件 | 3 | 40% |
| core | 10 个文件 | 4 | 40% |
| integration | 5 个文件 | 5 | 50% |
| session | 5 个文件 | 1 | 20% |
| config | 6 个文件 | 1 | 15% |

**目标**：把 tools / llm / skills 三个零覆盖模块补到 60%。

**修复**（按性价比排序）：
- [Step] → verify: [`packages/tools/__tests__/registry.test.ts`：测试 preExecuteHook 拦截、Zod 校验失败、output 截断]
- [Step] → verify: [`packages/tools/__tests__/security-hooks.test.ts`：用表驱动覆盖所有 PATH_TOOLS + bash 白名单场景]
- [Step] → verify: [`packages/llm/__tests__/provider.test.ts`：mock 4 个 provider SDK，验证 fallback 链 + MiniMax 模型名规范化]
- [Step] → verify: [`packages/skills/__tests__/loader.test.ts`：覆盖 SKILL.md frontmatter 解析、project/global 加载顺序]
- [Step] → verify: [`packages/skills/__tests__/registry.test.ts`：findByTrigger / findByName / list]

**工时**：1.5 天

---

### P1-2. CheckpointManager 走 devLogger

**问题**：`packages/core/checkpoint.ts` 用 `console.error('Failed to persist checkpoint:', error)` 和 `console.warn(...)`，不经过统一日志通道，敏感信息不会被 redact。

**修复**：
- [Step] → verify: [CheckpointManager 构造函数接受 `logger: DevLogger` 依赖]
- [Step] → verify: [`loop.ts` 创建 CheckpointManager 时传入 `devLogger`]
- [Step] → verify: [所有 console.* 替换为 devLogger.error/warn，触发一次写失败验证日志格式]

**工时**：30 分钟

---

### P1-3. Memory scope 判定改用 metadata

**问题**：`packages/memory/memory.ts` 的 `loadFromDir` 用 `dir.includes('global')` 判断 scope。
任何用户项目路径里碰巧含 "global" 字符串（例如 `D:\global\projects\foo`）就会被误判为 global scope。

**修复**：
- [Step] → verify: [`MemoryEntry` 类型加 `scope: 'global' | 'project' | 'session'`，`store()` 写入时带 scope，文件头加 YAML frontmatter 或 `.scope.json` sidecar]
- [Step] → verify: [`loadFromDir` 改用 entry 上的 scope 字段，不靠路径字符串匹配]
- [Step] → verify: [写一个测试：`loadFromDir('D:/test/global-suffix')` 不会把所有 entries 标为 global]

**工时**：2 小时

---

### P1-4. MCPIntegration 清理死代码

**问题**：`packages/integration/mcp.ts` 的 `connect()` 调用 `this.client.getServerCapabilities()` 后只用 `getServerVersion()`，前者结果丢弃。

**修复**：
- [Step] → verify: [删掉 `serverCapabilities` 那段，或真的把 capabilities 存起来使用]
- [Step] → verify: [如果保留，加注释说明为何 store]

**工时**：15 分钟

---

### P1-5. ConfigLoader.watch 资源清理

**问题**：`watch()` 注册的 `watcher` 在 `unwatch()` 调用前不会关。多次 reload 同一路径会泄漏旧 watcher。

**修复**：
- [Step] → verify: [`watch()` 先检查 `this.watchers.has(path)`，有则 close 旧的再注册新的（已有）]
- [Step] → verify: [增加 `disposeAll()` 方法，在 `runTUI` 退出钩子里调用，关闭所有 watcher]
- [Step] → verify: [测试：连续调用 3 次 `watch(samePath)`，验证 `watchers.size === 1`]

**工时**：30 分钟

---

### P1-6. devLogger uncaughtException 优雅退出

**问题**：`setupGlobalErrorHandlers` 在 uncaughtException 直接 `process.exit(1)`，没关闭 SQLite / MCP / fs 资源。

**修复**：
- [Step] → verify: [改为先 log → 触发 'before-exit' 事件让外部清理 → 5 秒后强制 exit]
- [Step] → verify: [手测：手动 throw 后看日志和退出码]

**工时**：1 小时

---

### P1-7. 统一 subagent 默认配置

**问题**：`packages/config/defaults.ts` 的 `blockedTools: ['delegate_task','clarify','memory_write','send_message']`（4 个），而 `loader.ts` 的 `discoverAndLoad` 兜底是 `['delegate_task','clarify','memory_write','send_message','execute_code']`（5 个）。

**修复**：
- [Step] → verify: [统一用 `SubagentConfigSchema.default.blockedTools`（5 个），删掉 `loader.ts` 的硬编码]
- [Step] → verify: [单测：parse 一个最小配置，`blockedTools` 长度 = 5]

**工时**：15 分钟

---

### P1-8. tool 描述 vs 实现对齐

**问题**：
- `codesearch` 描述说"使用 ripgrep"，但没 rg 就 throw，不会 fallback
- `lint` 描述说"自动检测 eslint/ruff/biome"，但 tsc 跑在最前，掩盖真正的 lint
- `websearch` 描述说"国内可用"，但 Bing 反爬严，captcha 频繁

**修复**：
- [Step] → verify: [codesearch 加 grep fallback（参考 `grep` 工具），描述改为"ripgrep 优先，自动 fallback"]
- [Step] → verify: [lint 移除 tsc（tsc 有专门的 run_tests 之外的路径），顺序改为 eslint/biome/ruff]
- [Step] → verify: [websearch 加 dry-run 模式（只读首页 + 1 条结果）让 LLM 评估可用性]

**工时**：1 小时

---

### P1-9. session-compactor 提取 reasoning parts

**问题**：`extractRules` 只处理 `role === 'user' | 'assistant' | 'tool'`，没处理 `role === 'assistant'` 的 `type === 'reasoning'` parts。
extended thinking（Claude 3.7+ 的思考过程）会从摘要里完全丢失。

**修复**：
- [Step] → verify: [`extractRules` 加 reasoning 提取分支，把 thinking text 收进 `conclusions` 或新字段 `keyDecisions`]
- [Step] → verify: [测试：构造一个含 reasoning parts 的 messages，验证 `conclusions` 包含 thinking 内容]

**工时**：30 分钟

---

### P1-10. 全项目错误日志通道统一

**问题**：项目内 `console.log` / `console.warn` / `console.error` 散落 50+ 处，大部分不走 devLogger，结果：
- 敏感字段不被 redact
- 日志不到 `~/.licode/logs/dev/`
- 无法按 category 过滤

**修复**：
- [Step] → verify: [`scripts/lint-no-console.sh` 或 grep 规则：禁止在 packages/ 下使用 console.*，必须用 devLogger]
- [Step] → verify: [把 50+ 处 console.* 改成 devLogger.*，按 category 分（TOOL / CONFIG / SESSION / MEMORY ...）]
- [Step] → verify: [跑一次完整流程，看 `~/.licode/logs/dev/` 是否有所有日志]

**工时**：半天

---

### P1-11. TUI `Sidebar` 删除 phase 引用（与 P0-1 关联）

**问题**：即使 P0-1 修了 sidebar，`Phase` 类型枚举只有 `EXECUTE | DONE`，Sidebar 显示什么信息？当前的 `phase: string` 字段也没数据源。

**修复**：
- [Step] → verify: [Sidebar 改为显示：当前 sessionId、消息数、token 用量、压缩状态、活跃 skill 名称。`isProcessing` 用 useLoop() 拿]
- [Step] → verify: [回归手测：跑一长对话，Sidebar 数据实时更新]

**工时**：2 小时

---

### P1-12. home.tsx slashItems 硬编码

**问题**：`packages/tui/routes/home.tsx` 的 `slashItems` 把 `/clear /compact /help` 写死，未来加命令要改两处（slashItems + handleSubmit）。

**修复**：
- [Step] → verify: [把命令抽到 `packages/tui/commands.ts` 的 `BUILTIN_COMMANDS` 数组，单一来源]
- [Step] → verify: [slashItems 从 BUILTIN_COMMANDS + availableSkills() 拼接]

**工时**：1 小时

---

## P2：优化（锦上添花）

| # | 项 | 工时 |
|---|----|------|
| P2-1 | write/edit 工具用真正的 unified diff（参考 `diff` npm 包） | 2h |
| P2-2 | 移除 `simple-git` 依赖（tools 用 exec('git')，未用到 SDK） | 30min |
| P2-3 | tsconfig.json 删掉 `customConditions: ["browser"]`（Bun 运行时不需要） | 5min |
| P2-4 | memory.ts `cleanup()` 改为单次 SQL/批量删除 | 30min |
| P2-5 | `_activeSecurityLayer` 全局单例 → 改 DI 注入 | 2h |
| P2-6 | 加 .editorconfig | 5min |
| P2-7 | 加 release 脚本（`scripts/release.ts`：bump version + update CHANGELOG） | 4h |
| P2-8 | 修复 DANGEROUS_PATTERNS 的 g 标志 + lastIndex | 15min |
| P2-9 | bunfig.toml 重复 preload（只在 [test] 保留即可） | 5min |
| P2-10 | README "快速开始" 改占位符 `your-username` 为实际仓库 | 5min |
| P2-11 | CHANGELOG 加 GitHub compare 链接 | 5min |
| P2-12 | docs 根 README.md 加索引 | 1h |
| P2-13 | ContextCompactor 与 SessionCompactor 合并（一个类两种策略） | 3h |
| P2-14 | loop.ts 注释清理（"七阶段"等历史描述） | 30min |

**工时合计**：约 1.5 天

---

## 实施顺序

按"互不阻塞 + 价值优先"分 4 个 sprint：

### Sprint 1：P0 修复（1 天）
1. P0-1（编译错误） → 阻塞一切，先做
2. P0-2（bun 白名单） → 5 分钟
3. P0-8（LICENSE） → 5 分钟
4. P0-4（provider 类型） → 1h
5. P0-7（pluginManager 决策，选 A 删） → 30min
6. P0-6（example 修复） → 30min
7. P0-3（安全配置联动） → 2h
8. P0-5（CI/CD） → 1h

**verify 节点**：`bunx tsc --noEmit --skipLibCheck` 零错 + `bun test` 全绿 + CI 第一次跑过

### Sprint 2：P1 测试覆盖（1.5 天）
- P1-1（五个测试文件）

**verify 节点**：`bun test --coverage` 显示 tools/llm/skills 三个包覆盖率 ≥ 60%

### Sprint 3：P1 杂项修复（1 天）
- P1-2、P1-3、P1-4、P1-5、P1-6、P1-7、P1-9（机械修复，半天）
- P1-8、P1-10、P1-12（涉及多文件，半天）

**verify 节点**：`bun test` 全绿 + `bun run dev` 跑一个 20 轮对话无 console 错误

### Sprint 4：P2 优化（1.5 天，可选）
- 按表格顺序做，影响不大

**verify 节点**：`bunx tsc` 零错 + `bun test` 全绿 + `grep -r "console\." packages/ | wc -l` ≈ 0

---

## 不做什么

明确划出本次范围外的事项：

- **新增功能**（不实现新工具、不加新 provider）
- **性能优化**（不重写 hot path，只修明显瓶颈）
- **架构大改**（不引入 DI 容器、不拆 monorepo workspace）
- **P2 中耗时 > 4h 的项**（release 脚本、ContextCompactor 合并推到后续）
- **国际化**（错误信息保持中英混合，暂不统一）
- **VSCode/JetBrains 插件**（仍是 terminal-only）
- **大规模测试**（不追求 90% 覆盖率，只补关键路径）
- **production-readiness-assessment.md 中的非代码项**（一键安装脚本、文档站、错误遥测）

---

## 验收清单

- [ ] `bunx tsc --noEmit --skipLibCheck` 零错（解决 sidebar 引用 phase 的报错）
- [ ] `bun test` 全绿，新增 ≥ 5 个测试文件
- [ ] CI 跑过至少一次
- [ ] `licode.config.json.example` 能被 `ConfigSchema.parse` 接受
- [ ] `bun run dev` 启动后 LLM 能跑 `bun test` 不被安全层拦
- [ ] 仓库根有 LICENSE 文件
- [ ] 50+ 处 `console.*` 至少 80% 改成 `devLogger.*`
- [ ] CHANGELOG.md 加 `[Unreleased]` 条目记录这次清理

---

## 相关文档

| 文档 | 用途 |
|------|------|
| [production-readiness-assessment.md](./production-readiness-assessment.md) | 6.5/10 评估，本次计划的依据 |
| [productization-plan.md](./productization-plan.md) | 5 阶段产品化，已完成 |
| [CHANGELOG.md](../../CHANGELOG.md) | 完成后在 [Unreleased] 写条目 |
| [CLAUDE.md](../../CLAUDE.md) | 全局规则（中文、TDD、worktree） |
