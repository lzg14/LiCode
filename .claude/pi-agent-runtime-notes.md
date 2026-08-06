# pi packages/agent 运行时代码分析笔记（供 licode 借鉴）

> 分析对象：`D:\ProjectFile\pi\packages\agent`（74+ 个 ts 文件）。只读研究，未改任何代码。
> 对比基准：licode 的 `packages/core/phases/execute/main.ts` —— 单文件巨型 `execute()` 函数：迭代 LLM 调用 -> 解析 tool-call -> 并发执行工具 -> push 回消息 -> 再调用。无清晰状态机/生命周期抽象。

---

## 一、总体架构：两层

`packages/agent` 分两个清晰的层，licode 可各取所需：

1. **低层 `src/`（通用 Agent 运行时，与存储无关）**
   - `agent.ts`：`Agent` 类，有状态的状态机封装，拥有 transcript、生命周期事件、队列。
   - `agent-loop.ts`：`runAgentLoop` / `runAgentLoopContinue`，纯函数式核心循环。
   - `types.ts`：全部核心类型。无 UI、无文件系统依赖、无 provider 依赖（好迁移）。

2. **高层 `src/harness/`（持久化 + 可恢复执行 + 工具实现）**
   - `agent-harness.ts`：`AgentHarness`/`AgentLane` 接口 + 操作/Action/Hook 枚举（当前实现大部分是 unavailable 脚手架，但接口/Action/类型设计已完整落地）。
   - `session/`：事件溯源式 durable session（tree + lane + operation log）。
   - `reducer.ts`：从 durable 记录纯函数重建 lane 状态（恢复/回放核心）。
   - `compaction/`、`tools/`、`session/context.ts`：具体实现。
   - 参考架构文档 `docs/harness-v2.md`（描述完整设计意图，代码中部分已实现）。

---

## 二、核心抽象清单与职责（一句话）

| 抽象 | 文件:行 | 职责 |
|---|---|---|
| `Agent` 类 | `src/agent.ts:173` | 有状态 loop 封装：持 transcript/state、发事件、管理 steer/followUp 队列、abort/等待 idle。 |
| `runAgentLoop` / `runAgentLoopContinue` | `src/agent-loop.ts:95,120` | 纯函数循环，接收 context/config/事件 sink，返回 newMessages。 |
| `runLoop(...)` | `src/agent-loop.ts:155` | 外层 while(followUp)、内层 while(tool call 或 steer)。核心循环体。 |
| `emit` 事件 sink | `src/agent-loop.ts:25` | 事件回调，只观察、不修改执行。 |
| `AgentEvent` | `src/types.ts:428` | 事件联合会（agent_/turn_/message_/tool_ 四级生命周期）。 |
| `EventStream` | `src/agent-loop.ts:145` | push 事件 + 以 agent_end 收尾并携带最终消息。 |
| `AgentState`（可变） | `src/agent.ts:68` | isStreaming/streamingMessage/pendingToolCalls(toolCallId Set)/errorMessage，可订阅。 |
| `AgentTool` | `src/types.ts:386` | 工具定义：schema + prepareArguments + execute(callId, params, signal, onUpdate) + 每工具 executionMode。 |
| `AgentToolResult<T>` | `src/types.ts:361` | content/details/usage/addedToolNames/terminate。 |
| `ToolExecutionMode` | `src/types.ts:42` | sequential|parallel，逐工具可覆盖。 |
| `QueueMode` / `PendingMessageQueue` | `src/types.ts:50`、`src/agent.ts:125` | steer/followUp 消息队列，drain all 或 one-at-a-time。 |
| 工具 hook before/afterToolCall | `src/types.ts:277,292`、`src/agent-loop.ts:600,713` | 执行前拦截(block/terminate)、执行后覆盖(isError/terminate)。 |
| `SessionState` | `src/harness/session/state.ts:50` | 内存状态：单调 seq、entry 树、records、pending 队列、log；applyMutation 校验 seq 连续性。 |
| `SessionMutation`/`applyMutation` | `src/harness/session/state.ts:17,97` | 事件溯源式变异（entry/record/lane/fact）。 |
| `Session` / `SessionTree` / `view()` | `src/harness/session/session.ts:102` | durable session 门面，多 lane 视图。 |
| `SessionStorage` 接口 | `src/harness/session/types.ts:279` | 后端无关存储（append entry/record、find、lane、fact、stats）。 |
| `Entry`/`Record`(lane) | `src/harness/session/types.ts:67,203` | 对话树(Entry)+ operation log(Record)。 |
| `reduceLaneState` | `src/harness/reducer.ts:506` | 纯函数从 Record 重建 lane 状态、校验损坏。 |
| `ActionInfo` | `src/harness/agent-harness.ts:182` | 单步枚举：append/record/lane/fact/stream_assistant/execute_tool/hook/sleep 等。 |
| `Harness`/`AgentLane` | `src/harness/agent-harness.ts:271,305` | 操作接口：prompt/skill/compact/navigate/resume/abort/steer/followUp/nextRun。 |
| `HookName` | `src/harness/agent-harness.ts:198` | before/after_run、transform_context、before_request、before/after_tool、before_compaction 等。 |
| `compaction.ts` | `src/harness/compaction/compaction.ts` | 基于 token 的上下文压缩：估算、cut point、split turn、配合重试。 |
| `context.ts` | `src/harness/session/context.ts` | 从 tree 派生 model/thinking/active tools 状态 + buildSessionContext(messages)。 |
| `convertToLlm`/自定义消息 | `src/harness/messages.ts` | 自定义消息扩展(bash/custom/branch/compaction) + 投影或过滤到 LLM。 |
| `Result`/ok/err/TaggedError | `src/harness/{types,result}.ts` | 永不 throw、返回 Result/编码错误 模式。 |

---

## 三、问题1：核心 agent loop 怎么组织？

**不是 StateMachine，而是双 while + 事件回调的结构化 async 循环**，外面包了一个 `Agent` 类做状态封装和队列管理。分两层：

### 纯函数循环（`agent-loop.ts:155`）
```
runLoop:
  outer: while(true)
    inner: while (hasMoreToolCalls || pendingMessages.length > 0)
      emit turn_start
      注入 pendingMessages（steer）
      streamAssistantResponse()   // 唯一把 AgentMessage[] 转 Message[] 的边界
      newMessages.push(message)
      stopReason error/aborted -> 发 turn_end/agent_end，return
      toolCalls = 过滤 content
      -> executeToolCalls()  // sequential/parallel
      -> 结果 push 回 currentContext.messages 和 newMessages
      emit turn_end(message, toolResults)
      config.prepareNextTurn?        // 每轮可置换 context/model/thinking
      config.shouldStopAfterTurn?    // 可优雅停机
      pendingMessages = config.getSteeringMessages()
    内层结束 = agent 会停
    followUp = config.getFollowUpMessages()
    有则 pendingMessages = followUp，外层 continue（再跑一轮）
    无则 break
  emit agent_end
```

### `Agent` 类（有状态包装）
- `_state`：`systemPrompt/model/thinkingLevel/tools/messages`（accessor getter/setter 拷贝数组）+ 运行时 `isStreaming/streamingMessage/pendingToolCalls/errorMessage`。
- 生命周期事件经 `subscribe(listener)` 广播，携带当前 run 的 `signal`。`processEvents` 先改内部状态再 await listeners。
- 队列：`steer()`/`abort()`/`followUp()` 把外部消息入队，loop 每轮通过 `config.getPendingMessages()/getFollowUpMessages()` 回调拉取注入。这是 licode 最缺的"中途介入"机制。
- abort：每个 run 独立 `AbortController`，经 `this.signal` 传给所有 hook 和 tool.execute(callId, params, signal)。
- `waitForIdle()`/`activeRun` 管理单并发 run（重复 prompt 抛错，必须 steer/followUp）。

**licode 对比**：licode 的 execute() 是单一 while，把调 LLM、解释 tool-call、并发执行、回推消息揉在一起，既无事件通知 TUI，也没把"可插拔 hook"和"steer/followup 注入"分离。pi 把 loop 拆成**纯函数（无状态、可测）+ 类外壳（状态/事件/队列）**。这是最关键的组织差异。

---

## 四、问题2：tool 执行抽象

### 工具定义（`src/types.ts:386`）
```ts
interface AgentTool {
  label;
  prepareArguments?(args);                // schema 校验前的兼容 shim
  execute(toolCallId, params, signal?, onUpdate?): Promise<AgentToolResult>;
  executionMode?: "sequential"|"parallel"; // 逐工具覆盖默认
}
```
- `validateToolArguments`（来自 pi-ai）校验参数。
- **产物统一为 `AgentToolResult{content, details, terminate, addedToolNames}`**，不抛错/不编码到 content。

### 执行管线：prepare -> execute -> finalize（`agent-loop.ts:600-758`）
- `prepareToolCall`：找工具 -> prepareArguments -> validate -> beforeToolCall hook（可 block{reason,terminate}）-> 校验 abort。所有错误/未知/block -> `ImmediateToolCallOutcome{isError:true}`，绝不 throw。
- `executePreparedToolCall`：调 tool.execute；支持 `onUpdate(partialResult)` 流式回传；收集挂起的 update 事件 promise；finally 置 acceptingUpdates=false 忽略迟到回调。
- `finalizeExecutedToolCall`：跑 afterToolCall hook，返回字段级覆盖（content/details/isError/terminate）。
- 输出 `ToolResultMessage{role:toolResult, toolCallId, isError, timestamp}` 回写 context。

### 并发：sequential / parallel（`agent-loop.ts:433,489`）
- sequential：逐个 prepare->execute->finalize->emit。
- parallel：先顺序 prepare（含安全拦截），可执行项包装成延迟 promise，Promise.all 并发；`tool_execution_end` 按工具完成序发出，tool-result message 再按 assistant source order 回写（保证 LLM 上下文顺序稳定）。
- 两种都支持 `terminate`：一批内**每个**最终结果的 terminate===true 才提前停机（`shouldTerminateToolBatch`）。

### abort / 超时
- abort：所有 tool 收到 `signal`（从 agent abort 传播）。每个工具间检查 signal.aborted 则 break，返回 "Operation aborted" 错误结果。
- 超时在**工具侧**（如 bash 的 `execShellWithTimeout`），不由 runtime 统一做。

### li借助点
licode 的 `registry.ts` 只有单个 `preExecuteHook` 做安全。pi 把它扩展为 **before/afterToolCall 双 hook + 每工具顺序 + onUpdate 流式 + abort 贯穿**。licode 的安全 hook 能重塑为 beforeToolCall 形状，并可加 afterToolCall 做 UI/审计覆盖。

---

## 四、问题 3：会话/消息历史的表示与传递

- **运行时 (`Agent`)**：`_state.messages: AgentMessage[]` 内存数组，未归一化、不持久化。
- **持久化 (`harness`)**：`Session` 持四类状态：
  1. **tree**：`Entry`（消息/model/thinking 切换/active tools/compaction 摘要/分支摘要/自定义），以 `parentId` 链式组织，只增不改，无复制。
  2. **lanes**：lane = name + leaf（branch 头），每次 append 推进，navigation 跳指针。
  3. **lane operation log**：说明线性的 `LaneRecord` 序列（operation_started / step_attempt / tool_started / queue_enqueued / write_hooks / usage / operation_finished 等）。这是可恢复性的基础。
  4. **global facts**：name/label，最新写生效。
- 所有写共享同一个单调 `seq`。
- Session 之上派生 context：`session/context.ts:buildSessionContext` 从 tree（含 compaction/分支摘要、custom 投影）平展成运行时的 `AgentMessage[]`，供 convertToLlm 用。
- 自定义消息通过 TS 声明合并（messages.ts 的 `declare module`）扩展 `CustomAgentMessages` union，运行时消息（bashExecution/custom 等）在 convertToLlm 里投影成 user 消息或过滤。

**licode 对比**：licode session 是 SQLite 扁平 message，1000 条阈值简单截断，无 tree、无 lane、无 operation log。pi 的 tree+record 是能恢复/回放/并行 lane 的基础。

---

## 五、问题 4：licode 没有的机制（最有价值）

1. **事件化生命周期**：`AgentEvent` 四级通道（agent/turn/message/tool），观察与执行分离。
2. **中断 / 恢复（durable execution）**：
   - `SessionStorage` 后端无关，field 组成 operation log。
   - 崩溃后 `reduceLaneState` 从 record 重建 lane 状态，`resume()` 从断点继续（重试未完成 step / 协调半完成 tool batch / 领取 deferred handle）。
   - 保证 no-partial-outcome：所有效果先写 intent record（pre-provisioned id），再补 entry（同上）。id 存在但内容不同 = 文件损坏，拒绝。
3. **deferred provider 请求**：assistant 停步后 `stopReason:'deferred'` 携带 handle，run 暂停；`resume()` 兑付 handle，续跑。适合长任务/batch API。
4. **checkpoint + auto-compaction（token 预算）**：基于 provider usage 做 token 估算、找 cutpoint、split-turn、overflow guard（长度/溢出重试一次），比 licode 的 1000 条截断智能得多。
5. **注入队列（steer/followUp/nextRun）+ 多 lane**：外部实时"中途纠正/停止后再追加/给下一轮预置"，支持 all/one-at-a-time。
6. **Abort 语义**：steer 队列死亡但返回 payload 给调用方，nextRun 存活；deferred write 在 abort 仍 applied。
7. **测试驱动确定性 stepping（drive: automatic/manual）**：`ActionInfo` 枚举把每个效果做成单步，可一步驱动、任何边界停机、关掉重开模拟 crash。生产/测试同一条路径。

---

## 六、licode 最值得借鉴的 5 个具体设计点

### 借鉴点 1：事件与生命周期解耦 —— 把 execute loop 先拆成"纯循环"和"状态外壳"
- **pi 怎么做**：`runAgentLoop`(agent-loop.ts) 是纯函数，只接收 context/config/emit 事件，不持有全局状态；`Agent` 类在 `agent.ts` 负责积累 state，通过 `processEvents` 广播 `AgentEvent`，由 subscribe() 暴露给 UI。执行与观察彻底分离。
- **licode 怎么做**：`execute/main.ts` 巨型 `execute()` 一边调 LLM 一边改内部状态，TUI 只能轮询/读全局，无事件流。
- **迁移成本**：低~中。把 runAgentLoop 式回调引入 licode，TUI 订阅 agent/turn/message/tool 事件即实时渲染，无需动 LLM/tool 逻辑。收益立竿见影（TUI 焕然）。

### 点 2：把 preExecuteHook 扩展成 before/afterToolCall 双 hook + onUpdate 流式
- **pi 怎么做**：`prepareToolCall` 先跑并 `beforeToolCall(可 block+terminate)`（executionMode 前）；执行后跑 `afterToolCall`（覆盖 content/isError/terminate/详情）；工具通过 `onUpdate(partialResult)` 流式回传，`tool_execution_update` 事件驱动 UI 的 live 输出（bash 逐行/progress）。
- **licode 怎么做**：只对标 `registry.ts` 的 `preExecuteHook`，安全拦截；无 afterToolCall、无 onUpdate。TUI 里 bash 输出只能执行完成后一次性贴回。
- **迁移成本**：中。给 licode Tool 加 `onUpdate` 回调，bash 工具逐 chunk 回调；把 preExecuteHook 挪进 beforeToolCall，另加 afterToolCall。收益：bash 终端输出实时渲染、安全逻辑更贴近 pi。

### 点 3：steer/followUp 外部输入队列（中途纠正）
- **pi 怎么做**：`Agent` 有 `steer()`/`followUp()` 队列 + `PendingMessageQueue(所有/all or one-at-a-time)`；loop 每轮通过 `getPendingMessages()/getFollowUpMessages()` 注入。用户 typing 时用 steer 实时重定向，或 followUp 在 agent 即将停时追加任务。steer/followUp 在 abort 时死亡并返回 payload 给调用方。
- **licode 怎么做**：一次 `prompt()` 是不可打断的 execute；用户中途改方向只能发新消息排队，无法精确注入到"当前轮后"。
- **迁移成本**：中。在 licode execute 每轮间加两个 drain 回调节点，TUI 加 steer/follow 按钮；`pendingToolCalls` 状态现成。收益：多 prompt 场景体验大幅提升。

### 4：durable session：tree + lane operation log + 确定性恢复
- **pi 怎么做**：`Session`(state.ts+session.ts) 用 Entry 多 + LaneRecord 构成 operation log；所有效果先写 intent（provisioned id）再补 entry；`reduceLaneState`(reducer.ts) 从 record 纯函数重建状态，`resume()` 从断点继续 —— crash 只回到"未发生或可完成"。多 lane 可并行（Slack 线程= lane）。
- **licode 怎么做**：session 是 SQLite 扁平 message，崩溃只能重开，无法定位"未完成的 tool 或 step"；无操作日志无 lane。
- **迁移成本**：高（这是 pi 最深、也是最多的持久化/合规工程）。licode 可先做最小版：给 assistant message + tool_result 加恢复点（记录此 turn 已完成几个 tool），崩溃后 resume 跳过已完成。不必一步到位 operation log。

### 5：基于 token 的上下文压缩替代 1000 条截断
- **pi 怎么做**：`compaction.ts` 用 provider usage / token 估算（estimateTokens）找 cut，支持 split-turn（把超大轮前缀单独总结）、overflow guard（响应超长 -> 丢弃 -> 压缩 -> 重试），摘要作为 compaction entry 进 tree，保留近 tail；摘要用专门 prompt 生成结构化，可增量更新。
- **licode 怎么做**：session-compactor 按 **1000 条** 硬阈值压缩，无 token 语义、无 split-turn、无溢出回退。
- **迁移成本**：中。在 licode SessionCompactor 按估算 token（pi 有现成 estimateTokens 启发式）替换条数阈值，复用现有 summary 生成；不必一次引入 compaction entry / split 语义，先做 token 预算替换。

---

## 六、关键词文件路径索引（绝对）
- 低层 Runtime：`D:\ProjectFile\pi\packages\agent\src\agent.ts`
- 核心循环：`D:\ProjectFile\pi\packages\agent\src\agent-loop.ts`
- 类型/事件/工具抽象：`D:\ProjectFile\pi\packages\agent\src\types.ts`
- 高层 API 桩 + Action/Hook 枚举：`D:\ProjectFile\pi\packages\agent\src\harness\agent-harness.ts`
- Durable Session tree + storage：`D:\ProjectFile\pi\packages\agent\src\harness\session\session.ts`, `state.ts`, `types.ts`
- 确定性恢复：`D:\ProjectFile\pi\packages\agent\src\harness\reducer.ts`
- 上下文构建（tree->messages）：`D:\ProjectFile\pi\packages\agent\src\harness\session\context.ts`
- Compaction：`D:\ProjectFile\pi\packages\agent\src\harness\compaction\compaction.ts`
- 工具实现（bash/read/edit/write）：`D:\ProjectFile\pi\packages\agent\src\harness\tools\`
- 架构设计文档：`D:\ProjectFile\pi\packages\agent\docs\harness-v2.md`

## 结论（建议 licode 拆步骤做）
按投入产出排序：
-（低）事件流解耦 -> TUI 实时化、可测。
-（中）before/afterToolCall + 流式 -> 安全更精细、bash 实时输出。
-（中高）steer/followUp 队列 -> 中途纠正。
-（中）token 预算 compact -> 省 token、语义更准。
-（高）durable session tree + 确定性 resume -> 长期项，先做最小恢复点。
`Agent`/`runAgentLoop`(agent.ts/agent-loop.ts) 是结构最干净的样板，licode 迁移的首选参考；harness session/reducer 属于更高层的可恢复基建，需单独立项。
