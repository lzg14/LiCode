# licode 项目说明

本文件是 **licode 项目专属**的 Claude Code 说明。通用规则（中文交流、TDD、Git 权限、目录约定等）见全局 `C:\Users\lzg14\.claude\CLAUDE.md`，本文档**不重复**那些规则，只补充 licode 项目特有内容。

---

## 项目定位

**Terminal-native AI coding agent** — 参考 MiMo Code 架构，支持多 LLM provider、持久化 session、工具调用、技能系统。

定位从最初的"Personal AI OS / 学习 AI Agent 架构的 playground"调整为"产品化工具"，核心目标从"理解 Agent"转为"真正能用"。

---

## 技术栈

| 层 | 选型 |
|---|---|
| 运行时 | Bun（>= 1.3.14）|
| 语言 | TypeScript（ESNext + bundler resolution）|
| 模块系统 | ESM（`type: module`）|
| TUI | SolidJS + @opentui/core + @opentui/solid |
| LLM SDK | `ai` (v6) + @ai-sdk/anthropic / openai |
| Schema | Zod 4 |
| 数据库 | SQLite（bun:sqlite，会话 + FTS5 记忆）|
| 测试 | Vitest |

**TypeScript 关键配置**：
- `strict: true`
- `noEmit: true`（用 `bun run` 直接跑 TS）
- `jsx: preserve`，`jsxImportSource: "@opentui/solid"`
- 编译时跳过 lib check：`tsc --skipLibCheck`

---

## 目录结构

```
D:\ProjectFile\licode\
├── packages/              # 业务模块（monorepo 但无 workspace 工具）
│   ├── core/              # Core Loop（已简化为单 EXECUTE 阶段）
│   ├── tools/             # 34 个内置工具
│   ├── session/           # SQLite 持久化 + 历史压缩
│   ├── tui/               # SolidJS 终端 UI
│   ├── config/            # 多层级配置
│   ├── llm/               # Provider 抽象
│   ├── security/          # 命令白名单 + 路径校验 + 危险命令拦截
│   ├── skills/            # Skill 系统（loader 待补）
│   ├── memory/            # FTS5 记忆
│   ├── workflow/          # Workflow 模板（.prompt.md）
│   ├── integration/       # MCP / Git / 数据库集成
│   ├── cli/               # 入口（仅调 runTUI）
│   └── audit/             # 审计日志（已删除）
├── docs/                  # 设计文档
│   ├── README.md
│   ├── core-loop/         # 七阶段等早期设计（保留作历史）
│   ├── modules/           # 各模块设计文档
│   └── plans/             # 实施计划（产品化 / 集成 / 重构）
├── licode.config.json.example
├── package.json
├── tsconfig.json
└── CHANGELOG.md
```

**注意**：licode **没有** `packages/{agent,server,snapshot,question,worktree,plugin}` 这些目录了 — 它们在 2026-06-21 的 `refactor: 清理死代码 + 功能增强` commit 中删除。如果发现 `git log` 引用这些目录，那是历史。

---

## 常用命令

```bash
# 启动 TUI（开发模式）
bun run dev

# 单次运行 CLI
bun run packages/cli/index.ts

# 类型检查
bunx tsc --noEmit --skipLibCheck

# 跑测试
bun test                              # 全部
bun test packages/tools               # 单包
bun test packages/core/__tests__/session-recovery.test.ts   # 单文件

# 构建
bun run build                         # tsc 到 dist/

# Lint（暂无 ESLint/Prettier 配置，按全局 CLAUDE.md 的 ruff 不适用）
```

---

## 文档约定

### 实施计划（`docs/plans/`）

每个实施计划是独立的 markdown 文件：

```
docs/plans/<topic>-plan.md
```

**必须有**：
- 顶部 `**目标**` 一句话
- 顶部 `**日期**`：YYYY-MM-DD 格式
- 步骤列表，每步有 `[Step] → verify: [check]`
- "不做什么" 区块（明确排除范围）

**当前位置**：
- `productization-plan.md` — 5 阶段产品化（已完成大部分）
- `claude-code-skills-integration.md` — Skill 集成计划
- `slash-menu-simplification.md` — `/` 菜单精简计划
- `roadmap.md` — 总体路线图
- `workflow-system.md` — Workflow 设计（早期）
- `fix-intermediate-text-duplication.md` — 历史修复

**完成后**：在 `CHANGELOG.md` 的 `## [Unreleased]` 加条目。

### 设计文档（`docs/core-loop/`、`docs/modules/`）

文件名格式：`YYYYMMDD-<topic>.md`。早期文档遵循这一格式。

### CHANGELOG.md

遵循 [Keep a Changelog](https://keepachangelog.com/)。每次发版本或重大重构前更新。

---

## 工作流程

### 添加新功能

1. **写计划**：`docs/plans/<feature>-plan.md`（用 `planning` skill）
2. **审批后实施**：拆小任务派给 subagent（用 `parallel-agents` skill）
3. **测试驱动**：核心逻辑先写测试（用 `tdd` skill）
4. **完工前自证**：`bunx tsc` + `bun test` 通过（用 `verification` skill）
5. **同步文档**：README + CHANGELOG 同一 commit 或相邻 commit
6. **提交**：中文 + 功能标签（`feat:` / `fix:` / `docs:` / `refactor:` / `test:` / `chore:`）

### 修 bug

1. **复现 + 仪表化**（用 `debugging` skill）
2. **修最小变更**，每行追溯到 bug
3. **加回归测试**，防止再发

### 架构调整

1. **先审现状**（用 `architecture` skill）
2. **设计目标 + 边界**（用 `codebase-design` skill）
3. **写计划 → 实施 → 验证**

---

## 架构现状（重要）

### Core Loop（已简化）

`packages/core/phases/` 目录**只剩 `execute.ts`**。原七阶段（OBSERVE/THINK/PLAN/BUILD/VERIFY/LEARN/PLAN-REVIEW）已删除。

```ts
// packages/core/types.ts
export type Phase = 'EXECUTE' | 'DONE'
```

LLM 自己判断用什么工具，Core Loop 不强制阶段。

### 安全层（核心）

`packages/tools/registry.ts` 的 `preExecuteHook` 是安全关键：

- bash 工具：白名单 + 危险命令拦截（rm -rf、sudo、curl|sh 等）
- write/edit/delete_file/apply_patch/move_file/copy_file：路径检查（deniedPaths）
- 默认拒绝语义（malformed input 自动 deny）
- MCP 工具也走同一钩子（`mcp__{server}__{tool}` 模式匹配）

**修改这一块必须谨慎**。

### Session 持久化

`packages/session/session.ts` 用 SQLite：

- 历史消息带 tool-call/tool-result parts
- 自动压缩（30/100 条限制）
- 跨启动恢复最近 session

### TUI

`packages/tui/` 用 SolidJS + @opentui：

- `home.tsx` 是主路由
- `context/loop.tsx` 是核心状态
- `context/todos.ts` 是规划状态
- `/` 斜杠命令菜单**只列 skills**（详见 `slash-menu-simplification.md`）

---

## 私有 Skill 整合

licode 的 skill 系统**直接消费** `C:\Users\lzg14\.claude\skills\` 下的 SKILL.md。

文件格式：
```
{name}/SKILL.md
---
name: <skill-name>
description: <一句话说明>
whenToUse: <何时用>
---
<markdown 内容>
```

加载顺序（详见 `claude-code-skills-integration.md`）：
1. `~/.claude/skills/`（全局）
2. `./.claude/skills/`（项目级，向上找）

---

## 已知重要约束

| 项 | 说明 |
|---|---|
| `cd ... &&` 禁止 | 用 `git -C "D:/ProjectFile/licode"` 或绝对路径 |
| 自动 git push | 禁止，必须用户确认 |
| 自动 git commit | 允许 |
| 推送前 lint | 全局规则说 `ruff check src/`，但本项目是 TS，**改为 `bunx tsc --noEmit --skipLibCheck`** |
| 长对话压缩 | 自动触发，30 条 / 100 条阈值，详见 `session-compactor.ts` |
| 工作树管理 | 用 `git-worktrees` skill（全局） |

---

## 不在全局 CLAUDE.md 中但本项目需要注意

1. **Bun 优先于 npm/yarn/pnpm** — 用 `bun install` / `bun add`
2. **不用 ruff** — 本项目是 TypeScript，类型检查用 `tsc`，格式化暂无强制
3. **plan 文档日期格式** — `**日期**：YYYY-MM-DD`，每个 plan 必有
4. **`docs/superpowers/` 路径不存在** — 历史路径，现在用 `docs/plans/`
5. **`packages/{agent,server,snapshot,question,worktree,plugin}` 不存在** — 已删除

---

## 故障排查速查

| 症状 | 查 |
|---|---|
| `bun run dev` 黑屏/布局错 | TUI 首次 resize 问题，app.tsx 有 setTimeout 兜底 |
| session 跨启动丢失 | 看 `licode-sessions.db` 是否在 cwd 根 |
| LLM 调用 401 | 检查 `ANTHROPIC_API_KEY` 环境变量 |
| tool-call 报错 "orphan" | `execute.ts` 的 `findValidStart` 截断逻辑（已修） |
| 安全 hook 误拦 | 看 `registry.ts` 的 `pathTools` 名单 |
| 编译失败但 tsc 不报 | 某些隐式 any 在 `bun test` 跑时才暴露 |

---

## 沟通语言

**用中文**（继承全局）。commit message 也用中文。

文档、变量名、API 名用英文。

---

## 相关文档

| 文档 | 用途 |
|---|---|
| [README.md](../README.md) | 用户面向的项目介绍 |
| [CHANGELOG.md](../CHANGELOG.md) | 版本变更记录 |
| [docs/plans/productization-plan.md](./plans/productization-plan.md) | 5 阶段产品化计划 |
| [docs/plans/claude-code-skills-integration.md](./plans/claude-code-skills-integration.md) | Skill 集成 |
| [docs/plans/slash-menu-simplification.md](./plans/slash-menu-simplification.md) | `/` 菜单精简 |
| 全局 [CLAUDE.md](file:///C:/Users/lzg14/.claude/CLAUDE.md) | 全局规则 |