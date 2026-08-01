# Changelog

本项目所有重要变更都会记录在此文件。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Changed
- **移除 simple-git 依赖**：`packages/integration/git.ts` 改用 `child_process.exec` 直接调用 git CLI，减少约 200KB 依赖体积
- **清理 CHANGELOG.md 重复条目**：删除 v0.4.0 中重复的"测试"、"工程"、"文档"部分

### Added
- **tools 包测试扩展**：新增 `glob.test.ts`、`git.test.ts`、`shell.test.ts`；扩展 `bash.test.ts`（+7 用例）、`read.test.ts`（+5 用例）
- **测试覆盖提升**：tools 包测试从 44 个用例增加到 131 个，覆盖更多边界场景和安全拦截
- **Skill 自动触发系统 Phase 1**：system prompt 注入可用技能索引，AI 可自主判断何时调用 skill 工具
  - `packages/skills/types.ts`：`Skill` 接口增加 `triggerHints` 字段，新增 `SkillIndex` 类型
  - `packages/skills/loader.ts`：新增 `extractTriggerHints()` 从 SKILL.md "何时用" 段落提取触发提示；新增 `getSkillIndex()` 获取 skill 索引
  - `packages/core/phases/execute/context.ts`：`ExecuteContext` 增加 `availableSkills` 字段
  - `packages/core/phases/execute/main.ts`：`buildSystem()` 注入 skill 索引表格
  - `packages/core/loop.ts`：`LoopContext` 增加 `availableSkills`，传递给 execute
  - `packages/tui/context/loop.tsx`：运行时加载 `availableSkills` 并传递

## [0.4.3] - 2026-07-05

### Fixed
- **subagent 工具 "OK: (无输出)" 三次根因修复 — 接口字段错配**：`SubagentResult` 字段是 `text/error/durationMs`（`packages/core/subagent.ts:27-33`），但 `phases/execute/main.ts:212-213` 按 `ToolResult` 接口读 `output` —— 字段不存在 → 永远 `undefined` → 触发 `?? '(无输出)'` fallback → 主循环告诉 LLM `OK: (无输出)`。修复：在 main.ts subagent 分支显式 `execResult = { success: subResult.success, output: subResult.text, error: subResult.error }` 把 `SubagentResult` 适配成 `ToolResult` 形状。配套回归测试 `execute-e2e.test.ts`：断言第二轮 streamText 调用时 tool message content 的 tool-result value 不含 `(无输出)` 且含 subagent 真实输出
- **TUI 内存泄漏和消息列表闪烁**（`eaf29dd`）：LoopProvider 添加 onCleanup 清理所有资源；streamingSegments 添加防抖；processedMessages 添加稳定 key；onIntermediateText 平滑过渡；prompt 模块级变量清理
- **Anthropic API baseUrl /v1 后缀修复**（`978f579`）：统一处理第三方 Anthropic 兼容 API 的 baseUrl 缺少 /v1 后缀问题
- **callLLM streamResult 泄漏修复**（`2a809fa`）：修复 callLLM 在 abort/timeout/异常路径泄漏 streamResult 内部 stitchableStream
- **TUI 代码审查问题修复**（`fddeed5`）：tool-batch 展开逻辑、SIGINT handler 重复清理、_latestClosedSegments 竞态、prompt 模块级变量迁移
- **TUI message-list.tsx UTF-8 BOM 和乱码注释清理**（`e5fde7b`）

### Changed
- **代码质量提升**（`code-quality-improvement-plan`）：清理死代码（KeybindProvider/DialogProvider/_MAX_VISIBLE_TOOLS/copy 别名/_latestVersion/_duration/calculateCost）、修复 Spinner 动画、修复 ToastProvider 内存泄漏、修复 MessageItem 响应式缺陷、修复核心包 any 类型、修复错误吞没
- **基础设施补全**：`.gitignore` 添加 `test_api.js`；`package.json` 添加 `clean` 脚本；`helpers.ts` 末尾换行修复
- **工具测试补充**（`tool-tests-plan`）：为 read/write/edit/bash/grep 5 个高频工具补充独立测试文件（共 27 个测试），含安全拦截场景验证
- **同步 I/O 改异步**（`async-io-plan`）：`session-compactor.ts`/`memory.ts`/`loader.ts` 共 33 处同步 I/O 改为 `node:fs/promises`，提取共享 `exists` helper 到 `packages/core/utils/fs.ts`

## [0.4.1] - 2026-07-05

### Added
- **Introspection M2 实现 + Memory store v2**（`691a60c`）：Memory store 升级到 v2（AnyMemoryEntry / writeRaw generic / safeFileId 解决 Windows 文件名禁用字符）；新建 `packages/core/intelligence/` 模块（types / recorder / adapter / registry / fallback / index + 4 个 decision handler + 4 个 decisions 单测 + adapter/registry/fallback/recorder 单测 共 11 个测试）
- **Introspection M5 集成**（`dda972b`）：`execute/main.ts` 集成 `IntelligenceAdapter`——`beforeExecute` 拼接 augmented prompt + `afterExecute` 记录 decision 事件到 Memory v2；`loop.ts` 把 `memory` + `modelInfo` 透传给 execute，`execute/context.ts` 接收对应字段
- **Subagent 状态展示 L1+L2**（`12eec7e`）：TUI subagent 任务在侧栏 / Status 区域显示运行时状态（running / done / failed）+ startTime/endTime；`ExecuteContext` 加 `onSubagentStart` / `onSubagentEnd` 钩子
- **侧栏累计 token + 压缩摘要 markdown 渲染**（`6d4b1fb`）：`/tokens` 命令显示会话累计 token；`/compress` 输出由 JSON 改为可读 markdown
- **Introspection M1/M4 spike + eval 框架 + M2 spec**（`092ffe2`）：`verifyProject` / `verbosity` 等 4 个决策的 spike 实现 + `evals/` 评估脚本
- **docs(plans): 智能增强计划 v2 + hardware-adaptive 架构设计**（`93c1bbb` + `e86c4e1`）：10 章节补充 + 3 个 M 合并/推迟 + hardware-aware model fallback 设计

### Changed
- **docs: 工程根禁止建临时目录**（`6963ac8`）：`.gitignore` 收 `.mimocode/`，docs/README 警示

### Fixed
- **subagent 工具"结果丢失"根因修复**（`5846d81`）：`buildToolsWithExecute` 给 tool 传 `execute` 函数时，AI SDK v6 会自动执行 + 自动 push tool-result 到 messages；但 subagent 内部循环又手动执行 + 手动 push tool-result → **同一工具被执行两次 + messages 中同 toolCallId 有两条 tool-result** → 第二次 `generateText` 解析失败 → 返回空 text → break → `(无输出)`。修复：buildToolsWithExecute 不传 `execute` 函数，让 subagent 真的手动控制（手动执行 + 手动 push tool-result 仍是单一来源）
- **subagent 工具 "Tool result is missing" 二次修复**（`f9c28c2`）：`execute/main.ts` 传 subagent 的 messages 过滤 role 时，**未清理 assistant.content 里的 tool-call parts**——AI SDK v6 看到 orphan tool-call（没对应 tool-result）抛 `MissingToolResultsError`。修复：filter 完 role 后再 `.map` 清理 assistant.content 里的 `tool-call` parts
- **SyntaxStyle 资源耗尽崩溃**（`f9c28c2`）：`thinking-view.tsx` 的 `MarkdownTextInline` 用 `const fallbackSyntaxStyle = createMarkdownSyntaxStyle(...)` 每次 mount 都新建 SyntaxStyle → n 个 message 累积 n 个 native handle → opentui `createSyntaxStyle` 返 null → 抛 `Failed to create SyntaxStyle` → ErrorBoundary 触发 → 整个 message-list 渲染崩溃 → TUI 卡死。修复：`createMemo` 懒求值 + 顶层 `sharedSyntaxStyle` 共享
- **SessionCompactor 循环触发压缩**（`f9c28c2`）：`hasSummary` 路径漏调 `trimOldMessages`——SQLite 持续累积 → 下次 limit 1000 加载又看到 1000+ 条 → 又触发压缩。修复：抽 `trimAfter()` 函数，两条路径（同步/异步）都调
- **Subagent 状态展示 status bar 常驻**（`f9c28c2`）：从 sidebar 移到 status bar 底部常驻，sidebar 不再重复显示
- **压缩后从 SQLite 删除旧消息，防止循环压缩**（`11cad9b`）：`SessionCompactor` 在压缩完成后从 SQLite 物理删除已被摘要替代的旧消息，而不是仅写摘要不删 SQLite（之前每次 turn 都触发压缩）

### Tests
- **subagent 状态跟踪测试**（`2e1c335`）：覆盖 `ExecuteContext.onSubagentStart/End` 状态机的 running → done / running → failed 转移；`loop.test.ts` 补 `task` / `endTime` 字段（`6d1cd33`）配合类型一致性

## [0.4.0] - 2026-07-05


### 修复
- **streamText 解析失败吞 tool-call（最严重的 silent failure）**：
  - 根因：AI SDK v6 的 `streamText` result 在 Bun + 全双工 stream 下 `fullStream` AsyncIterable 会抛 `TypeError: generatorStream.pipeThrough is not a function`，但 execute.ts 用 try/catch 吞掉 + 从 fullStream 累积 streamedToolCalls，导致 LLM 实际生成的 tool-call 全部丢失，user 看到"LLM 说要做但实际什么都没做"
  - 修复：改用 AI SDK v6 的 promise 路径（`Promise.all([result.text, result.toolCalls, result.usage, result.finishReason])`）拿最终结果，fullStream 只用作流式 callback（`onStreamText`）；每个 promise 配 `safeAwait` helper 单独 catch，stream 失败也能拿到完整 tool-call 和文本
  - 关联修复：`hasToolCases` 累积标志错位——tool-call 后的纯文本被当"中间文本"用 `return ""` 吞掉（`"return hasToolCases ? "" : fullText"`）。修：tool-call 后纯文本就是最终回复，必须 `return fullText`，不再调 `onIntermediateText`
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
- **TUI 消息显示闪烁 + 切换跳变修复**（根因：markdown 组件 mount 触发 stickyScroll 整 viewport 重绘 + 流式闭合段与最终消息视觉不一致）：
  - **syntaxStyle 提升到顶层**：`MessageList` 顶层 `createMemo` sharedSyntaxStyle，所有 markdown 共享避免每实例 createMemo 重建；`MarkdownText` / `ThinkingView` 加可选 `syntaxStyle` prop
  - **markdown 永远 `streaming={true}` + `conceal={true}`**：避免 streaming 切换到 false 触发 finalize 整 viewport 重绘；消除"非高亮 → 高亮"切换
  - **PendingStreamView 合并显示**：text 段 + pending 合并成单一 markdown 组件，thinking 段用 `CollapsibleText maxLines=5` 灰色折叠（恢复 fbc5161 行为）；删除 streamingSegments 独立 For 渲染，避免 markdown 频繁 mount
  - **ScrollBox 改回 mimocode 风格**：`paddingRight: 1` + 滚动条 `visible: true`（之前自创的 `paddingRight: 0` + 滚动条 hidden 反而引入问题）
- **SessionCompactor 循环触发压缩修复**（根因：loop.ts 加载 history 不传 limit）：
  - **根因**：`getMessagesAsModelMessages(sessionId)` 不传 limit → 加载完整 SQLite 历史（807 条）→ `shouldCompact` 看到 808 一直触发；压缩只写摘要不删 SQLite → 下次还是 808 → 又触发。每次 turn 都压缩且压缩后历史涨到 808 又压缩
  - **修复**：`loop.ts:304` 调 `getMessagesAsModelMessages(ctx.sessionId, { limit: 1000 })`，SQLite 层就裁剪到最近 1000 条；`shouldCompact` 看到的 msgCount 不再是完整历史
  - **配套调阈值**：`maxMessages: 200 → 1000`（触发阈值放宽）；`preserveRecent: 30 → 100`（压缩后保留更多上下文）；`execute.ts` 的 `PRESERVE_RECENT` 同步 `30/100 → 100/200`
- **等待 LLM 响应时 ESC/ctrl+D 无效修复**（根因：home.tsx useKeyboard 没在 isProcessing 时调 abort）：
  - **ESC 根因**：home.tsx 第 182 行只处理 `scheduler.hasTasks()` 分支（stopLoops），等待 LLM 响应时 ESC 完全无效
  - **Ctrl+D 根因**：opentui TextareaRenderable 默认 keyBindings 把 Ctrl+D 绑到 "delete" action（vim 风格，光标处删除字符），focus 在 prompt 时事件被内部吞掉，不冒泡到 useKeyboard
  - **修复**：`home.tsx` 的 useKeyboard 加 isProcessing 分支：ESC/ctrl+D 触发 `abort()` + addMessage "已取消当前执行"；`useLoop()` 解构补 `abort`
- **ToolName 类型更新**：扩展 ToolName 类型覆盖全部 39 个工具，确保类型安全
- **SecurityConfig 重复定义合并**：消除 SecurityConfig 接口的重复定义，统一到一处
- **zodToJsonSchema 重复消除**：移除重复的 zodToJsonSchema 实现，统一使用单一来源
- **Projector 残留阶段名清理**：清理 Projector 中残留的七阶段名称引用



### 安全
- **bun 加入白名单**：BASE_WHITELIST 添加 bun/bunx
- **whitelist-bunx 测试**：新增 bunx 命令白名单测试
- **命令注入漏洞修复**：将 7 处 execAsync 调用改为 execFileAsync，防止命令注入攻击
- **路径遍历漏洞修复**：checkPath 函数添加 path.resolve 规范化路径，防止路径遍历
- **敏感信息泄露修复**：env_vars 工具过滤敏感环境变量（如 API_KEY、SECRET 等）
- **API Key 持久化防护**：save() 方法过滤 apiKey 字段，防止密钥意外写入会话存储

### 测试
- **stream-accumulator 测试**：16 个用例覆盖跨 chunk 标签、thinking/system-reminder 闭合
- **thinking-display 测试**：14 个用例覆盖 4 种状态转换
- **help-content 测试**：验证帮助数据结构
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
- **删除 4 个未使用的文件**：清理 429 行死代码，包括 packages/audit/ 下的文件
- **- **session.ts `?? 0` 死代码清理**（`22c8986`）：`row.created_at ?? 0` / `row.updated_at ?? 0` 在 `rowToSession` 是死代码（schema 是 NOT NULL），移除后类型推断出 `number` 强类型
- **SessionStatus type guard**（`22c8986`）：加 `SESSION_STATUSES` 常量 + `parseSessionStatus(raw)`，DB 写入的 status 字符串读出时验证，落到 `unknown → failed` 兜底
- **execute phases 类型严格化**（`22c8986`）：移除 `(ctx.model as { modelId?: string })?.modelId` 冗余断言；新增 `ModelMessage` 类型；`helpers.ts` 把 `content: any[]` 替换为 `content: MessageContent[]`

### 工程
- **CLI 测试脚手架**（`82a2d71`）：`logs.ts` 加 `export` + `import.meta.url` side-effect gate 让模块可被测试导入；新建 `__tests__/logs.test.ts` 覆盖 `--help` / `list` / `ERROR` 过滤 / `search` / `tail` 5 用例
- **TUI 测试脚手架**（`82a2d71`）：`loop.tsx` 加 `parseImageRefs` export；新建 `context.test.ts` 覆盖 todos / shortcuts signals + `parseImageRefs` 共 6 用例
- **Release workflow**（`82a2d71`）：`.github/workflows/release.yml` 在 `v*` tag 上自动跑 3 平台 build + lint + test，上传 dist artifact + 创建 GitHub Release；新增 `RELEASING.md` 人工发布 checklist
- **CI coverage 上传（T08 from v0.3.1 audit）**（`5032a77`）：`ci.yml` test step 加 `--coverage --coverage-reporter=lcov`（bun 原生支持），ubuntu matrix 把 `coverage/lcov.info` 上传为 workflow artifact；`.gitignore` 加 `coverage/` / `*.lcov` 规则

### 文档
- **v0.3.1 improvement audit §12 实施状态追踪**（`5032a77`）：原 audit（2026-07-04 14:00 起草）6 小时内被多 agent 完成 7 项（T01/T02/T05/T06/T07/T12/T13），追写 §12 标注 ✅/⏳ 状态 + sprint 对比 + 显式记下 T11 与 25cccb4 的设计方向冲突

### 工程（unreleased 续）
- **TUI home.tsx 智能 stickyScroll 去重**（`1a87656`）：合并 `5a27feb` + `eebdf42` 时 `checkAtBottom` 函数和 `const [stickyEnabled, setStickyEnabled] = createSignal(true)` 各被声明了两次（biome `noRedeclare` 编译错）。删除旧版（带 `return atBottom` boolean 返回）+ 重复 declare 后保留最简版（无返回值箭头函数 + 信号），下游 4 处 `setTimeout(checkAtBottom, 50)` + `stickyScroll={stickyEnabled()}` 使用不受影响


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