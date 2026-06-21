# Changelog

本项目所有重要变更都会记录在此文件。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 新增
- **输入框快捷键**：完整的光标移动（`←/→/Home/End/Ctrl+A/Ctrl+B/Ctrl+E/Ctrl+←`）、选择（`Shift+方向键`/`Ctrl+Shift+A`）、删除（`Ctrl+D/H/W/K/U/X`）、复制粘贴（`Ctrl+C/V`）、清空（`Ctrl+L`）。对齐 VS Code / readline 习惯。

### 变更
- **`/` 菜单精简**：移除 `/model`、`/provider`、`/search`、`/save`、`/load`、`/workflow` 六个命令。`/compact` 保留。换模型改用 `Ctrl+M`。
- **新增 `/clear`**：开新会话（清空 UI，保留 SQLite 数据）。
- **Skill 集成**：从 Claude Code `~/.claude/skills/` 直接加载 SKILL.md 作为 licode 技能，删除硬编码的 coding/research/review workflow 模板。`/skill` 命令可用（`/workflow` 保留为别名，向后兼容）。

## [0.2.0] - 2026-06-21

### 新增
- **安全层**：工具执行前增加 `preExecuteHook` 机制，统一拦截
  - 命令白名单校验（bash 工具）
  - 路径安全检查（write / edit / delete_file / apply_patch / move_file / copy_file）
  - 危险命令模式拦截（rm -rf / sudo / curl|sh / chmod 777 等）
  - 默认拒绝语义（malformed input 自动 deny）
- **规划工具**：`todo_write` / `todo_read` 工具，LLM 可追踪多步骤任务
- **TUI 侧栏**：实时渲染 todos 列表（已完成 / 进行中 / 待办 / 取消）
- **MCP 集成**：启动时自动连接配置的 MCP 服务器，工具动态注册到 registry
  - 工具命名规范 `mcp__{serverId}__{toolName}`
  - MCP 工具自动走安全校验
  - 5s 连接超时
- **上下文管理**：项目级 `.licode.md` / `LICODE.md` 自动加载
  - 支持 global（`~/.licode/`）+ project 两级合并，project 优先
  - 上下文窗口用量侧栏预警（>80% 黄，>95% 红）
- **Workflow 模板**：coding / research / review 三套预设 prompt 模板
  - `/workflow <name>` 命令切换模式
- **危险命令二次确认**：检测到危险操作直接拒绝执行

### 修复
- **核心循环简化**：删除七阶段硬编码（OBSERVE/THINK/PLAN/BUILD/VERIFY/LEARN），Phase 类型收窄为 `EXECUTE | DONE`
- **apply_patch 工具**：从简陋的 `+` 行追加重写为 `git apply` 子进程 + JSON Patch fallback
- **历史消息管理**：限制单次请求历史数量（30 条 / 100 条），过滤 tool 角色，校验 tool-call / tool-result 配对
- **TypeScript 类型**：修复 `as` 强转绕过 schema 校验的安全缺陷；`z.record` 补齐 zod v4 双参数
- **TUI UX**：斜杠菜单从全屏覆盖改为输入框上方内嵌；`/` 单独输入显示使用提示；`Tab` 键补全命令

### 移除
- `packages/core/phases/{observe,think,plan,plan-review,build,verify,learn}.ts` — 七阶段硬编码文件
- `packages/core/phases/index.ts` — 重导出
- `packages/workflow/engine.ts` — Workflow 引擎实现（沙箱太重）
- `packages/workflow/sandbox.ts` — 沙箱实现
- `packages/workflow/builtin/registry.ts` — 旧的脚本注册器
- `packages/workflow/builtin/{coding,research,review}.js` — JS 工作流脚本（替换为 .prompt.md）
- `packages/workflow/index.ts` / `types.ts` / `registries.ts` — 配套导出
- `packages/tui/component/phase-bar.tsx` — 已无引用的死代码

### 文档
- 重写 README.md：移除过时的七阶段描述；新增核心特性列表（安全层 / MCP / 上下文管理 / Workflow 模板）；新增测试说明
- 新增 `docs/plans/productization-plan.md` — 产品化实施计划

## [0.1.0] - 之前

最初的 Core Loop + Session + Tools + TUI 基础实现。