# Changelog

本项目所有重要变更都会记录在此文件。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 安全
- **devLogger 敏感字段 redact**：自动遮蔽 apiKey / token / password 等字段，以及内联 API key 字符串（sk-ant-* / sk-* / ghp_* / Bearer 等）。旧日志已清理。

### 修复
- **Slash 菜单 Tab 后回车确认**：Tab 把命令辅助填入输入框后，按回车现在能正确执行命令（之前回车把命令当普通文本发给 LLM）。新增 pendingSlashCmd 状态标记命令来源。

### 新增
- **`/help` 命令**：输入 `/help`、`?` 或按 `F1` 查看所有快捷键（光标/选择/删除/复制粘贴等），按类别分组显示。
- **输入框快捷键**：完整的光标移动（`←/→/Home/End/Ctrl+A/Ctrl+B/Ctrl+E/Ctrl+←`）、选择（`Shift+方向键`/`Ctrl+Shift+A`）、删除（`Ctrl+D/H/W/K/U/X`）、复制粘贴（`Ctrl+C/V`）、清空（`Ctrl+L`）。对齐 VS Code / readline 习惯。

### 重构
- **Thinking 显示逻辑抽成纯函数**：`deriveThinkingDisplay()` 在 `packages/tui/util/thinking-display.ts`，4 种状态（empty / thinking-only / has-rest / no-thinking）覆盖所有场景，14 个单测保护。
- **Security 配置合并逻辑抽成纯函数**：`mergeSecurityConfig()` + `PLATFORM_DEFAULTS` 在 `packages/security/merge.ts`，单一源消除 app.tsx / defaults.ts 重复。

### 体验
- **流式响应分块展示**：generateText 改 streamText，每收到闭合的 `<thinking>` / `<system-reminder>` 段立刻展示，未闭合段暂时当正文流式显示。消除"30 秒静默 + 突然 2 屏"的体验断层。兼容 `<thinking>` 和 `<think>` 两种标签格式。
- **`/compact` 改用 LLM 总结**：压缩时优先调用 LLM 生成连贯摘要（3-5 句），规则提取降为降级方案。压缩结果在 TUI 中展示，标注 `[LLM 摘要]` 或 `[规则提取]`。

### 测试
- **append 合并逻辑测试覆盖**：8 个用例验证默认+用户配置正确合并（追加+去重）
- **PowerShell 危险模式实测**：7 个用例覆盖 Remove-Item / Set-ExecutionPolicy / Invoke-Expression / iex 管道
- **stream-accumulator 测试**：16 个用例覆盖跨 chunk 标签、thinking/system-reminder 闭合、混合格式等边界情况

### 清理
- **删除死代码 ~1900 行**：`packages/integration/` 未使用的 database/mcp-server/mcp-tools/notes 模块、`packages/memory/` 未使用的 recell/fts5 模块、`packages/tui/` 未使用的 autocomplete 组件及其测试文件。
- **硬件码版本号统一**：sidebar、User-Agent、MCP client 全部统一为 0.2.0。

### 变更
- **`/` 菜单精简**：移除 `/model`、`/provider`、`/search`、`/save`、`/load`、`/workflow` 六个命令。`/compact` 保留。换模型改用 `Ctrl+M`。
- **新增 `/clear`**：开新会话（清空 UI，保留 SQLite 数据）。
- **Skill 集成**：从 Claude Code `~/.claude/skills/` 直接加载 SKILL.md 作为 licode 技能，删除硬编码的 coding/research/review workflow 模板。`/skill` 命令可用（`/workflow` 保留为别名，向后兼容）。

## [0.2.0] - 2026-06-21

### 新增
- **安全层**：工具执行前增加 `preExecuteHook` 机制，统一拦截
  - 命令白名单校验（bash 工具）
  - 路径安全检查（write / edit / delete_file / apply_patch / move_file / copy_file）
  - 危险命令模式直接拒绝（rm -rf / sudo / curl|sh / chmod 777 等）
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

### 修复
- **核心循环简化**：删除七阶段硬编码（OBSERVE/THINK/PLAN/BUILD/VERIFY/LEARN），Phase 类型收窄为 `EXECUTE | DONE`
- **apply_patch 工具**：从简陋的 `+` 行追加重写为 `git apply` 子进程 + JSON Patch fallback
- **历史消息管理**：限制单次请求历史数量（30 条 / 100 条），过滤 tool 角色，校验 tool-call / tool-result 配对
- **TypeScript 类型**：修复 `as` 强转绕过 schema 校验的安全缺陷；`z.record` 补齐 zod v4 双参数
- **TUI UX**：斜杠菜单从全屏覆盖改为输入框上方内嵌；`/` 单独输入显示使用提示；`Tab` 键补全命令

### 移除
- `packages/core/phases/{observe,think,plan,plan-review,build,verify,learn}.ts` — 七阶段硬编码文件
- `packages/core/phases/index.ts` — 重导出
- `packages/workflow/` 全部文件 — Workflow 引擎 + 模板（沙箱太重，改为 skill 驱动）
- `packages/tui/component/phase-bar.tsx` — 已无引用的死代码

### 文档
- 重写 README.md：移除过时的七阶段描述；新增核心特性列表（安全层 / MCP / 上下文管理）；新增测试说明
- 新增 `docs/plans/productization-plan.md` — 产品化实施计划

## [0.1.0] - 之前

最初的 Core Loop + Session + Tools + TUI 基础实现。
