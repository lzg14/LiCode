# Changelog

本项目所有重要变更都会记录在此文件。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 修复
- **SessionCompactor 失效根因修复（MiniMax-M3[1M] 等带后缀模型）**：
  - **effectiveContextWindow 链路**：`createModel` 返回 `{ model, contextWindow }`，用原始 `config.model` 字符串查 catalog（不被 normalize 副作用影响）；TUI `LoopProvider` 加 `effectiveContextWindow` prop；`Sidebar` 优先用它替代 `getModelConfig(currentModel())`（`currentModel` 是被 normalize 剥后缀的 modelId，会让 MiniMax-M3[1M] 用户误报 128K 而不是 1M）
  - **fallback 阈值收紧**：`CompactionConfig` 新增 `unknownModelThreshold = 100_000`，未注册模型走 `Math.min(maxTokens, unknownModelThreshold)` 而不是单一的 `maxTokens=200_000`（之前 fallback 200K 让绝大多数模型永远触发不了压缩）
  - **silent-fail 升级**：`onCompaction` 回调加第 4 个参数 `error?: Error`；后台压缩失败从 `devLogger.debug` 升级到 `devLogger.warn`，并把错误回调给上层；TUI 加 `compactionError` signal，sidebar 显示 `⚠ 压缩失败: ...`
- **内存泄漏 4 个根因修复**：
  - `subagent.ts` race timer 永不 clearTimeout → 每个 subagent 调用泄漏一个 timeoutMs 长寿闭包
  - `Memory.entries` 永久累积 + `cleanup()` 从不被调用 → 长期运行后 Map 单调增长；新增 `hardCap` (默认 1000) 自动淘汰最旧
  - `appendMessageWithParts` 把完整 part 对象写到 `parts.metadata.raw` → 同一份数据在 SQLite 存 3 份；去掉冗余，parts 表保留专门字段（tool_name/tool_call_id/args/result）
  - `getMessagesAsModelMessages` 加可选 `limit` 参数，SQLite 层就裁剪，避免长会话每次 turn 加载整个 history；TUI 重建默认传 limit=200
- **加载过期 memory 文件不再入内存**：`Memory.loadFromDir` 用文件 mtimeMs 作为 updatedAt 并按 `maxAgeMs` (默认 30 天) 过滤；过期文件保留在磁盘上由显式 `cleanup()` 删除

### 测试
- **resolveContextWindow 单元测试**：7 个用例覆盖 MiniMax-M3 / MiniMax-M3[1M] / 未注册模型查表行为
- **session-compactor unknownModelThreshold 回归测试**：3 个用例验证未注册模型走更紧兜底、contextWindow 已知仍走 80%、maxTokens 不会拉大兜底
- **subagent clearTimeout 回归测试**：验证 spawn 完成后 race timer 必须 clearTimeout
- **memory eviction 回归测试**：3 个用例覆盖过期文件不入内存、store 超过 hardCap 淘汰最旧、加载时按 mtime 限制数量
- **session metadata 冗余回归测试**：验证 parts.metadata 不再包含完整原始对象
- **session limit 选项测试**：3 个用例验证 getMessagesAsModelMessages limit 选项
- **builtin.ts 5 个 bug 修复**：删除重复 datetime 注册、codesearch 添加 grep/findstr fallback、grep findstr 路径修复、readClipboardImage 使用动态 import、apply_patch 使用 ctx.cwd
- **subagent 工具"结果丢失"修复**：`subagent.ts` 内部循环构造 tool-result 漏 `type: "tool-result"` 字段，AI SDK v6 zod schema 校验失败，子 agent 第二轮 generateText 拿不到工具结果，accumulatedText 为空返回 `(无输出)`。主循环 `execute.ts` 早就写对了 type，只有 subagent 漏写
- **streaming 重复输出修复**：移除 streamText 完成后重复调用 onStreamText
- **slash 命令修复**：Tab 选择后按 return 正确执行
- **queued 消息颜色**：从灰色改为蓝色更醒目
- **PageUp/PageDown/Home/End 滚动**：启用 scrollbox 内置快捷键
- **ESC 中断**：流式输出时 ESC 正确处理 AbortError

### 安全
- **bun 加入白名单**：BASE_WHITELIST 添加 bun/bunx
- **whitelist-bunx 测试**：新增 bunx 命令白名单测试

### 测试
- **stream-accumulator 测试**：16 个用例覆盖跨 chunk 标签、thinking/system-reminder 闭合
- **thinking-display 测试**：14 个用例覆盖 4 种状态转换
- **help-content 测试**：验证帮助数据结构

### 重构
- **streamText 流式输出**：generateText 改 streamText，支持逐 chunk 回调
- **PendingStreamView 重构**：去掉 Switch/Match，改用单一子树 + 条件 Show
- **batch() 合并更新**：streamingSegments 和 pendingText 使用 batch() 减少重渲染
- **ContextCompactor 移除**：删除未使用的死代码

### 文档
- **docs 死链修复 + README 模块表加版本/日期列**（`aefcd87`）
- **TUI 模块总览**：`docs/modules/tui.md` 新增
- **verify-protocol**：新增强制自检规范

### 清理
- **删除 CHANGELOG 重复标题**
- **zod 版本改为 ^4.4.3**
- **删除 package-lock.json**
- **.gitignore 补充临时文件和调试日志规则**
- **移除 .licode/tui.json**
- **移动计划文件到 docs/plans/**
- **删除 ENV_X220.md**

## [0.3.0] - 2026-06-23

### 新增
- **MIT LICENSE 文件**（`ce929c4`）：补全仓库法律文件，README 顶部加 License badge。
- **GitHub Actions CI/CD**（`671956e`）：3 平台矩阵跑 `bun install --frozen-lockfile` + `bunx tsc --noEmit --skipLibCheck` + `bun test --run` + `bun run build`。README 顶部加 CI badge。
- **`/help` 命令**：输入 `/help`、`?` 或按 `F1` 查看所有快捷键，按类别分组显示。
- **输入框快捷键**：完整的光标移动、选择、删除、复制粘贴快捷键，对齐 VS Code / readline 习惯。
- **`docs/plans/production-gaps-2026-q3.md`**：最新生产差距评估（7.5/10）。Sprint 1 P0 全部 4 项已完成。

### 修复
- **Thinking 折叠显示**（`fbc5161`）：stream-accumulator 暴露 `mode` 字段，TUI 提前检测 thinking 状态；PendingStreamView 直接以灰色折叠框（maxLines=5）渲染，消除亮→灰闪烁。
- **每个 tool 独立 try/catch**（`0fe1dab`）：handler throw 时仍返回 `{ success: false, error: "..." }`，防止 `Promise.all` 中一个工具崩溃导致整个 batch 无结果。
- **会话恢复 tool 消息高亮**（`07a9b38`）：`getSessionModelMessages()` 暴露完整 parts，onMount 重建 ✓⏳✗ 彩色图标。
- **消除 message-list 双滚动条**（`07a9b38`）：内层 `<scrollbox>` 改 `<box>`，由 home.tsx 外层统一管理滚动。
- **恢复 stickyScroll 自动滚动**（`22c4314`/`18da60f`）：简化 scrollbox 配置，去掉非法 `overflow="scroll"` prop，保留新消息自动滚动 + 手动拖拽暂停。
- **Slash 菜单 Tab 后回车确认**（`979a388`）：Tab 填入命令后回车正确执行，新增 pendingSlashCmd 状态标记。
- **Windows 命令白名单扩展**（`36681e1`）：追加 `findstr`/`sort`/`more`/`systeminfo`/`ipconfig`/`netstat`/`taskkill`。

### 安全
- **devLogger 敏感字段 redact**（`979a388`）：自动遮蔽 apiKey / token / password 及内联 API key 字符串。

### 重构
- **Thinking 显示逻辑抽成纯函数**（`979a388`）：`deriveThinkingDisplay()` 在 `packages/tui/util/thinking-display.ts`，4 种状态覆盖所有场景，14 个单测。
- **Security 配置合并逻辑抽成纯函数**（`979a388`）：`mergeSecurityConfig()` + `PLATFORM_DEFAULTS` 在 `packages/security/merge.ts`，消除重复。

### 体验
- **`/compact` 改用 LLM 总结**（`453f703`）：压缩优先调用 LLM 生成连贯摘要（3-5 句），规则提取降为降级方案。TUI 标注 `[LLM 摘要]` 或 `[规则提取]`。

### 测试
- **append 合并逻辑测试覆盖**：8 个用例验证默认+用户配置正确合并（追加+去重）。
- **PowerShell 危险模式实测**：7 个用例覆盖 Remove-Item / Set-ExecutionPolicy / Invoke-Expression / iex 管道。
- **stream-accumulator 测试**：16 个用例覆盖跨 chunk 标签、thinking/system-reminder 闭合、混合格式。

### 清理
- **删除死代码 ~1900 行**：`packages/integration/` 未使用的 database/mcp-server/mcp-tools/notes 模块、`packages/memory/` 未使用的 recell/fts5 模块、`packages/tui/` 未使用的 autocomplete 组件。
- **删除过期文档**：`docs/plans/production-todo.md`、归档 `docs/production-readiness-assessment.md`、`docs/HEADROOM-INTEGRATION-PLAN.md`，旧 plan 文档顶部加状态 banner 指向新文档。

### 变更
- **`/` 菜单精简**：移除 6 个冗余命令，换模型改用 `Ctrl+M`。
- **新增 `/clear`**：开新会话（清空 UI，保留 SQLite 数据）。
- **Skill 集成**：从 `~/.claude/skills/` 直接加载 SKILL.md，删除硬编码 workflow 模板。

### 文档
- **ENV_X220.md**（`ffae859`）：记录 X220T 完整开发环境，用于跨机对比调试。
- **TUI 模块组成与职责总览**（`87d6380`）：TUI 包内部模块结构文档。
- **`docs/silent-failures.md`**（`6c96499`）：列出 13 处 catch 的可见性分级，结论全部已合理处理。
- **过期文档清理归档**（`979a388`）

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
                                                                                                                                                                                                                                                                                                                                 