# licode 设计文档

**licode** - Terminal-native AI coding agent（v0.3.0）

> 本文档索引只列**当前活跃**的内容。已完成或过期的文档移至 `archive/` 目录，详见 [archive/README.md](./archive/README.md)。

---

## 文档结构

```
docs/
├── README.md                    # 本索引页
├── silent-failures.md           # 静默失败清单（catch 块可见性分级）
├── modules/                     # 各模块设计（活跃）
│   ├── config.md
│   ├── integration.md
│   ├── memory.md
│   ├── security.md
│   ├── skills.md
│   ├── tools.md
│   └── tui.md
├── plans/                       # 实施计划
│   ├── production-gaps-2026-q3.md  # 当前生产差距评估（活跃）
│   ├── shortcuts-test-coverage.md  # ⚠️ 未实施
│   ├── architecture-refactor-plan.md  # ⚠️ 草稿
│   ├── tui-render-optimization.md  # ⚠️ 未实施
│   └── archive/                 # 已完成的计划（详见 plans/archive/README.md）
├── reference/                   # 外部项目参考
│   └── opencode-analysis.md
└── archive/                     # 已废弃/历史设计（详见 archive/README.md）
```

---

## 当前活跃文档

### 顶层

- **[silent-failures.md](./silent-failures.md)** — 所有 catch 块的可见性策略清单（visible / warn / debug / swallow），作为 review 时的参考

### 模块设计（`modules/`）

| 文档 | 内容 |
|------|------|
| [config.md](./modules/config.md) | 配置层级、环境变量、外部导入、验证器 |
| [integration.md](./modules/integration.md) | Git / MCP / Plugin 集成层 |
| [memory.md](./modules/memory.md) | 三层记忆系统 |
| [security.md](./modules/security.md) | 命令白名单、路径校验、危险命令拦截 |
| [skills.md](./modules/skills.md) | Skills 加载器、registry、hot-reload |
| [tools.md](./modules/tools.md) | 工具分类、注册表、preExecuteHook |
| [tui.md](./modules/tui.md) | TUI 模块组成、职责、组件树 |

### 实施计划（`plans/`）

| 计划 | 状态 | 简介 |
|------|------|------|
| [production-gaps-2026-q3.md](./plans/production-gaps-2026-q3.md) | 活跃 | Q3 生产可用性差距 + 5-7 天集中开发 |
| [shortcuts-test-coverage.md](./plans/shortcuts-test-coverage.md) | ⚠️ 未实施 | 把 `shortcuts.test.ts` 从"测导出"升级到"测行为" |
| [architecture-refactor-plan.md](./plans/architecture-refactor-plan.md) | ⚠️ 草稿 | 架构重构早期方案（v1.0，2026-06-20） |
| [tui-render-optimization.md](./plans/tui-render-optimization.md) | ⚠️ 未实施 | 解决"已完成消息被反复触碰"的渲染优化 |

> ⚠️ 标记的计划**不**保证反映最新代码状态，实施前需要重新评估。

### 外部参考（`reference/`）

| 文档 | 内容 |
|------|------|
| [opencode-analysis.md](./reference/opencode-analysis.md) | opencode 架构分析笔记（v1.0.0，2026-06-17） |

---

## 归档

- **[archive/](./archive/README.md)** — 已废弃的设计文档和评估报告（核心循环旧设计、过期评估等）
- **[plans/archive/](./plans/archive/README.md)** — 已完成的实施计划归档（按完成时间倒序排列）

---

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| **运行时** | Bun (>= 1.3.14) | 快速启动、原生 TypeScript |
| **TUI** | SolidJS + @opentui | 响应式 UI、终端渲染 |
| **LLM** | Anthropic / OpenAI | 通过 Vercel AI SDK v6 抽象 |
| **核心** | TypeScript | strict 模式，ESM + bundler resolution |
| **持久化** | SQLite (bun:sqlite) | Session + FTS5 记忆 |

---

## 相关文档

- 仓库根 [README.md](../README.md) — 用户面向的项目介绍
- 仓库根 [CHANGELOG.md](../CHANGELOG.md) — 版本变更记录
- 仓库根 [CLAUDE.md](../CLAUDE.md) — Claude Code 项目说明
- 全局 [CLAUDE.md](file:///C:/Users/lzg14/.claude/CLAUDE.md) — 全局规则
