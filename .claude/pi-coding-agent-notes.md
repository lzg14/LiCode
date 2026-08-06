# pi coding-agent 深度分析（为 licode 找可借鉴）

> 研究范围：`D:\ProjectFile\pi\packages\coding-agent`（v0.84.0，523 个 ts 文件）+ 其依赖的 `packages/agent`（pi-agent-core 通用 Agent 循环）
> 目的：与 licode（terminal AI coding agent，SQLite 会话、39 工具、巨型 execute.ts）对比，提炼生产级设计
> 日期：2026-08-07
> 结论先行：pi 的架构核心是 **"通用 Agent 循环（无 UI/持久化）+ 事件订阅驱动 UI + 追加式 JSONL 会话树"**，licode 最值得借鉴的是它的会话树/分支模型、双循环流式队列、工具输出卫生、per-operation abort 体系。

---

## 一、整体架构分层（与 licode 对照）

```
packages/agent            pi-agent-core：通用 Agent 循环（agent-loop.ts）+ 工具执行，与 UI/持久化完全无关
packages/coding-agent     CLI 壳 + 编排层：
  src/main.ts             参数解析 → SessionManager → runtime → 按 appMode 分发（interactive/rpc/print）
  src/core/agent-session.ts   核心编排类 AgentSession（112KB，3342 行）—— 对应 licode 的 execute.ts 但职责更纯
  src/core/session-manager.ts 追加式 JSONL 会话树（1714 行）—— 对应 licode 的 SQLite session
  src/core/tools/         7 个内置工具（read/bash/edit/write/grep/find/ls）
  src/modes/              interactive（TUI）/ rpc（JSONL over stdio）/ print
  src/core/compaction/    手动 + 自动压缩
  src/core/extensions/    Extension 系统（加载/运行/事件）
packages/protocol+client+server   远程 daemon 多会话（SessionLease/snapshot），coding-agent 仅做客户端接线（experimental）
```

licode 的 `packages/core/src/phases/execute/main.ts` 巨型函数在 pi 被拆成三层：
- **agent-loop.ts（通用循环）**：只管"发 LLM → 收消息 → 跑工具 → 再发"，不知道 session/UI 的存在
- **agent-session.ts（编排层）**：挂事件钩子做持久化、扩展、自动压缩、重试
- **interactive-mode.ts（UI 层）**：只订阅事件渲染，通过 session.prompt() 说话

---

## 二、重点领域深挖（含文件+行号）

### 1. 命令调度 / 交互循环

**输入 → 命令路由**（interactive-mode.ts:2839-3026 `setupEditorSubmitHandler`）：
- 编辑框 `onSubmit(text)` 是一个 60 行长的手写分发链：`/settings` `/model` `/export` `/compact` `/login` … → `!cmd`/`!!cmd`（bash，`!!` 表示不进 LLM 上下文）→ 压缩期间排队 → streaming 期间 `prompt(text,{streamingBehavior:"steer"})` → 空闲时正常提交。
- 扩展命令（`pi.registerCommand`）由 `agent-session.ts:1278 _tryExecuteExtensionCommand` 在 `prompt()` 内部最先拦截，**streaming 期间也能立即执行**。

**prompt() 管线**（agent-session.ts:1116-1273）：
1. 扩展命令拦截（立即执行，不进 LLM）
2. `input` 扩展事件拦截/改写
3. skill 展开（`/skill:name` → 读 SKILL.md 内联）与 prompt 模板展开
4. streaming 时按 `streamingBehavior` 走 steer/followUp 队列
5. 校验 model + auth（OAuth 过期、无 API key 都有专门报错文案）
6. 注入 `_pendingNextTurnMessages` 与扩展 custom 消息 → 组装单条 user 消息 → `_runAgentPrompt`

**核心双循环**（agent/src/agent-loop.ts:155-275 `runLoop`）：
- **内层循环**：`hasMoreToolCalls || pendingMessages.length > 0` —— 每轮：注入 steer 消息 → `streamAssistantResponse` → 提取 toolCall → 并行/串行执行工具 → `prepareNextTurn` 钩子（agent-session.ts:535-556 每轮刷新 systemPrompt/tools/model/thinkingLevel）→ 查 steering 队列。
- **外层循环**：内层退出后查 follow-up 队列，有则续跑。
- 工具批执行：`executeToolCalls`（agent-loop.ts:411-426）按 `config.toolExecution` 或工具 `executionMode:"sequential"` 决定并行（Promise.all 保序）还是串行；`shouldTerminateToolBatch`（582）支持工具返回 `terminate:true` 提前停。
- **truncated 防护**：`stopReason==="length"` 时所有 tool call 一律不执行、直接返回错误（agent-loop.ts:381-406）——防止截断参数被当成合法参数执行。

**事件驱动**：`AgentSession.subscribe(listener)`（agent-session.ts:815）多 listener；内部 `_handleAgentEvent`（610）先广播扩展、再广播 UI、再做持久化。UI 只是订阅者（interactive-mode.ts:3034 `handleEvent` switch 渲染）。

### 2. Session / snapshot 保存恢复

**SessionManager：追加式 JSONL 树**（session-manager.ts:855）：
- 每个 entry 有 `id + parentId` 形成树；`leafId` 指针标记当前位置。文件格式：首行 session header（version/cwd/parentSession），之后每行一个 entry（message / thinking_level_change / model_change / compaction / branch_summary / custom / custom_message / label / session_info）。
- **延迟落盘**（`_persist`，1015）：文件在**第一条 assistant 消息**出现前不创建；`flushed` 标志控制先批量写后 append。崩溃最多丢"正在流式的半条 assistant 消息"，因为每条 `message_end` 立即 append（agent-session.ts:640-657）。
- **上下文投影**：`buildSessionContext`（461）/ `buildContextEntries`（418）沿 leaf 路径回溯，**compaction entry 之后只保留 `firstKeptEntryId` 起的条目**——压缩不删数据，只是投影时跳过。
- **版本迁移**：`migrateToCurrentVersion`（281）v1→v2→v3 原地迁移并重写文件。
- **鲁棒读取**：`loadEntriesFromFile`（514）逐行解析、坏行跳过；`readSessionHeader`（571）**有界扫描**（1MB 上限）用于快速发现；session 列表并发扫描上限 10（769）。

**恢复/续接入口**（main.ts:319-410 `createSessionManager`）：
- `--continue`（continueRecent，1557）、`--resume`（选择器）、`--session <path|id>`（精确 id 或前缀匹配，可跨项目，跨项目提示 fork）、`--fork <id>`（forkSessionOrExit）、`--session-id <id>`（指定新 session id，带格式校验 assertValidSessionId:212）。
- `SessionManager.forkFrom`（1579）：跨项目复制全部 entry 到新 session 并改 cwd；`createBranchedSession`（1412）：把树的单一路径导出为新文件。

**Branch/回滚**：`branch()`（1360）移动 leaf 指针即可回退（append-only，历史不删）；`branchWithSummary`（1381）回退时用 LLM 把废弃路径总结成 `branch_summary` entry；`resetLeaf()`（1372）。fork 时带 label 重建逻辑（1420-1471）。

### 3. 中断处理（abort / timeout / 中断恢复）

- **统一 abort**：`abort()`（agent-session.ts:1550）= abortRetry + agent.abort() + waitForIdle()。
- **每长操作独立 AbortController**：compaction / auto-compaction / branch-summary / retry / bash 各有专用 controller（327-339）；`_bashAbortControllers` 是 Set，`abortBash()`（2842）全部 abort，`isBashRunning`（2849）供 UI 判断。
- **bash 中断**：`createLocalBashOperations`（bash.ts:84-145）—— `signal` 触发 `onAbort` 杀**整个进程树**（taskkill 树状），`timeout` 秒参数有上限校验（`MAX_TIMEOUT_MS`，27-37）并抛 `timeout:<sec>` 错误由工具层转成友好文案（442-444）。
- **退避可中止**：自动重试 `_prepareRetry`（2700-2733）用 `sleep(delayMs, signal)`，指数退避 `baseDelay * 2^(n-1)`，中途 abort 会发 `auto_retry_end{success:false}` 让 UI 收尾。
- **工具执行层 abort 检查**：`prepareToolCall` 在 beforeToolCall 前后都查 `signal.aborted`（agent-loop.ts:629-654），abort 时工具结果直接置为 "Operation aborted" 错误而不是崩溃。
- **底层进程执行**（core/exec.ts:52-63）：SIGTERM → 5 秒后 SIGKILL 兜底。
- `raceWithAbortSignal`（utils/abort.ts:14）：把外部 signal 与操作 Promise 竞速的通用工具。

### 4. 多 agent / 多 session 并发（protocol 层）

两层设计：

**A. 进程内多 session（同一 AgentSessionRuntime）**：`agent-session-runtime.ts` —— `switchSession`（196）/ `newSession`（226）/ `fork`（262）在同一进程内替换 session，**复用 services**（settings/modelRuntime/resourceLoader）；`setRebindSession`（117）让模式层在 session 替换后重新绑定事件订阅。RPC 模式靠它实现 `new_session`/`switch_session`/`fork` 命令（rpc-mode.ts:433-441, 601-627）。

**B. 远程 daemon（protocol 是独立包）**：
- `src/client/remote-session.ts`：`RemoteSession` 类包装 `SessionLease`（pi-client），维护 `snapshot` + `transcript` 增量状态，有 lifecycle（unbound/ready/busy/disposed）、operation 追踪、dispose 竞态防护（#disposeSignal）。
- `src/client/transcript.ts`：**客户端增量合流** —— `applyTranscriptSnapshot` 按 revision 防回退（38），`applyTranscriptProgress` 把流式 delta 合并进 transcript（toolCall 参数用 buffer 累积到合法 JSON 才 parse，18-26），`selectTranscript` 把已完结项 + 进行中项 + queuedSteer 合成最终视图。
- `cli/experimental/commands/*`：实验性的 `pi server` / `pi client` 接线，未主流启用。
- **结论**：coding-agent 主路径是进程内多 session + JSONL RPC 嵌入；远程多 agent 走协议包，客户端侧已经具备快照/增量/恢复的全部抽象。licode 无此能力。

**RPC 模式**（modes/rpc/rpc-mode.ts）：JSONL over stdio，命令/响应/事件/扩展 UI 请求四类消息；`prompt` 用 `preflightResult` 回调决定"受理即回执" vs "完成后回执"（394-416）；stdout 全程接管保证协议纯净；SIGTERM/SIGHUP 处理 + 跟踪的子进程清理（366-380）。

### 5. 前向 / 回滚（checkpoint 类机制）

pi **没有** git 级 checkpoint / image save，它用更轻的方案：
- **Compaction entry**（session-manager.ts:69-80）：LLM 摘要 + `firstKeptEntryId` + tokensBefore + usage + 扩展 details；手动 `compact()`（agent-session.ts:1790）与自动（`_checkCompaction` 2000-2053：基于 usage 估算 token，超过 contextWindow 阈值或 overflow 恢复时触发，并防"压缩刚结束误触发"——用 usage 消息时间戳与 compaction entry 比较，2034-2044）。
- **Branch summary**（82-92）：废弃路径的 LLM 摘要，回退时保留上下文。
- **Label**（110-115）：用户给任意 entry 打书签，导航/筛选用。
- **Fork 导出**：单路径导出新 session（1412）、跨项目 fork（1579）。
- **前向=追加新 entry，回滚=移动 leaf**：append-only 使得任何一步都可回退、可分支、可导出。

### 6. licode 缺失的生产级细节

| 细节 | pi 实现（文件:行号） |
|---|---|
| stdout 接管（非交互模式工具不会污染协议/纯文本输出） | output-guard.ts:45-93 `takeOverStdout`，`writeRawStdout` 串行队列 + 背压等待（95-103） |
| bash 输出卫生：ANSI 剥离/二进制清洗/滚动缓冲/溢出写临时文件给模型读 | bash-executor.ts:78-129（`fullOutputPath`）；utils/shell.ts `sanitizeBinaryOutput` |
| 工具截断约定：每个工具 description 明写截断限制，超限返回 truncation 元信息 + 提示 | truncate.ts（truncateHead/truncateTail/truncateLine）、grep.ts:131、bash.ts:327 |
| 统一 diagnostics 收集/报告（warning/error 分级，main 汇总后决定退出码） | main.ts:86-102, 739-747；diagnostics.ts |
| 启动计时与基准（PI_STARTUP_BENCHMARK） | core/timings.ts；main.ts:866-911 |
| 多层级配置（global/project/user/会话级） | settings-manager.ts（40KB） |
| 启动迁移 + 弃用警告 | migrations.ts（main.ts:614） |
| 凭据存储：文件锁 + 0600 权限 + 读取校验 | auth-storage.ts:54-111, 180-190 |
| 自动重试（指数退避、可中止、UI 事件） | agent-session.ts:2700-2736；settings retry |
| 流式期间消息排队（steer/followUp 语义区分） | agent-session.ts:1379-1408；agent-loop.ts:167, 259, 263 |
| 模型/thinking 切换作为一等 session entry，随历史恢复 | session-manager.ts:58-67；buildSessionContext 的 getSessionContextSettings:362-377 |
| 流式工具参数缓冲（客户端侧才解析合法 JSON） | client/transcript.ts:18-26 |

---

## 三、核心抽象及职责（一句话）

| 抽象 | 职责 |
|---|---|
| `Agent`（packages/agent/src/agent.ts + agent-loop.ts） | 通用循环：LLM 调用 + 工具执行 + 队列，纯事件输出，无状态持久化 |
| `AgentSession`（core/agent-session.ts） | 编排层：绑定工具钩子/事件订阅，接管持久化、自动压缩、重试、扩展、bash、模型切换 |
| `SessionManager`（core/session-manager.ts） | 追加式 JSONL 会话树：append/branch/fork/投影/迁移/发现 |
| `AgentSessionRuntime`（core/agent-session-runtime.ts） | 进程内 session 生命周期：new/switch/fork/dispose，rebind 回调 |
| `InteractiveMode`（modes/interactive/interactive-mode.ts） | 事件订阅渲染 + 编辑框分发 + 选择器 UI，只通过 session 公共 API 交互 |
| `ExtensionRunner`（core/extensions/runner.ts） | 扩展事件总线：tool_call/tool_result/agent_start…/session_before_compact，可改写 LLM 往返 |
| `ResourceLoader`（core/resource-loader.ts） | 加载扩展/skill/prompt 模板/主题，含冲突检测与诊断 |
| `ModelRuntime`（core/model-runtime.ts） | provider/模型解析 + 凭据解析 + 可用性刷新 |
| `SettingsManager`（core/settings-manager.ts） | 多层级配置读写 + 错误 drain（不改写会炸初始化） |
| `SessionManager` 的 entry 类型 | message/compaction/branch_summary/custom/label 等，树中一等公民 |

---

## 四、licode 最值得借鉴的 3-5 个点

### 借鉴点 1：追加式会话树 + 分支/回滚/fork（对标 licode 的 SQLite 线性会话）
- **pi 怎么做**：JSONL append-only，entry 带 `id/parentId` 树；`leafId` 指针移动即回退；`branchWithSummary` 回退时用 LLM 摘要保留上下文；`fork` 导出单路径或跨项目；compaction 是投影层（`firstKeptEntryId`）而非数据删除；每条 `message_end` 立即落盘，崩溃最多丢半条流式消息（session-manager.ts:855-1714, agent-session.ts:640-657）。
- **licode 现状**：SQLite 线性历史（session.ts，1000 条自动压缩），无树、无分支、无回退；崩溃恢复只靠跨启动恢复最近 session，可能丢尾部消息。
- **移植成本：中**。licode 已是 SQLite：可在 messages 表加 `parent_id + leaf_id` 列 + 独立 entries 表（model_change/thinking/compaction/label），把压缩改成"投影"语义而非直接删行。最值钱的是 **append-only + 立即落盘** 与 **fork 语义**（licode 的 session-recovery 测试可扩展成分支测试）。

### 借鉴点 2：双循环流式队列（steer / follow-up）——用户打字不打断 agent
- **pi 怎么做**：agent-loop.ts:155-275 内外双循环；streaming 期间用户提交走 `steer`（下一 LLM 轮前注入）或 `followUp`（全部工具执行完后再处理）；队列在 UI 可见、可批量撤回回编辑框（interactive-mode.ts:4178 restoreQueuedMessagesToEditor）。三种模式共享同一 `prompt()` 入口，preflight 校验先行。
- **licode 现状**：单 EXECUTE 阶段，用户在 agent 运行时输入的行为没有定义（无队列语义）。
- **移植成本：中-高**。需要把 execute.ts 拆成可中断的 turn 循环并引入消息队列；但可以先做最小版：只在 `EXECUTE` 期间把输入排队、turn 边界注入，不改循环结构。

### 借鉴点 3：工具输出卫生（截断约定 + 溢出落盘 + 超时/进程树 kill）
- **pi 怎么做**：bash 输出 ANSI 剥离、二进制清洗、滚动缓冲（默认 ~20KB/5000 行），超限写临时文件并把 `fullOutputPath` 交给模型续读（bash-executor.ts:64-129）；bash 工具带 `timeout` 秒参数（上限校验）+ 进程树 kill + 超时友好报错（bash.ts:27-37, 84-145, 442-444）；grep/find/read 各自 description 明写截断限制（DEFAULT_MAX_BYTES/DEFAULT_MAX_LINES），超限返回元信息而非静默截断。
- **licode 现状**：39 个工具，安全重点是 pre-execute hook（白名单/危险命令/路径检查），输出卫生未见同等级（大输出会直接撑爆 context）。
- **移植成本：低**。纯增量：加一个共享 `truncate.ts` + 在 bash 工具加输出流式缓冲 + `fullOutputPath`；licode 已有 `output-accumulator`（core/tools）可扩展。

### 借鉴点 4：per-operation AbortController 体系 + 可中止的退避/压缩/retry
- **pi 怎么做**：compaction/auto-compaction/branch-summary/retry/bash 各有独立 AbortController（agent-session.ts:327-339, 1792, 2077, 2700-2733, 2842）；`raceWithAbortSignal` 通用工具；agent-loop 在工具执行前后检查 signal，abort 时工具结果归一为 "Operation aborted" 错误消息回给模型（agent-loop.ts:629-654）；bash 杀进程树、SIGTERM→SIGKILL 兜底（exec.ts:52-63）；RPC 模式 SIGTERM/SIGHUP + 子进程清理（rpc-mode.ts:366-380）。
- **licode 现状**：execute.ts 巨型函数，abort 语义没有系统性设计；`preExecuteHook` 安全层虽强但中断/超时恢复薄弱。
- **移植成本：中**。先给 bash 工具加进程树 kill + abort 检查点，再逐步给 compaction 等长操作独立 controller。

### 借鉴点 5：headless/RPC 复用同一核心（stdout 接管 + JSONL 协议）
- **pi 怎么做**：同一 AgentSession 驱动 interactive/rpc/print 三种模式（main.ts:599-930）；`output-guard.ts` 非交互模式接管 stdout 防污染；RPC 命令集覆盖 prompt/steer/abort/compact/switch_session/fork 等全部能力，`preflightResult` 回调实现"受理即回执"（rpc-mode.ts:394-416, 748-798）。
- **licode 现状**：只有 TUI；无 headless/嵌入协议；licode 的核心循环与 TUI 状态（context/loop.tsx）耦合。
- **移植成本：中**。licode 若要把核心循环与 TUI 解耦做成可嵌入层，可从"事件订阅 → JSON 事件"起步（pi 的 modes/json-event.ts 只有 1505 字节，是个极简例子）。

---

## 五、附：pi 有而 licode 没有 / licode 有而 pi 没有（对照）

**licode 领先**：
- 安全 pre-execute hook（bash 白名单、rm -rf/curl|sh 拦截、deniedPaths 路径检查、MCP 工具同钩子）—— pi 没有命令黑名单，安全靠"项目信任 + Esc 取消 + 输出卫生"。
- 39 个工具（pi 只有 7 个内置）。
- Bun 原生 + SQLite 单二进制心智模型。

**pi 领先（本次报告全部内容）**：会话树/分支/fork、双循环队列、abort 体系、输出卫生、多模式复用、事件驱动解耦、diagnostics 约定、扩展系统成熟度（tool_call/tool_result 钩子可改写 LLM 往返）。
