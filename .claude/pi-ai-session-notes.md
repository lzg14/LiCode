# pi 项目研究笔记（对比 licode）

> 研究对象：`D:\ProjectFile\pi` 的 packages/ai（313 ts）、packages/protocol、packages/session-backends、packages/server、packages/client
> 目的：为 licode（LLM 用 `ai` SDK v6 + @ai-sdk/anthropic/openai；session 单一 SQLite 实现）找可借鉴点
> 结论先行：pi 走的是"自建统一 LLM 层 + CBOR 二进制协议 + daemon server/client + 可插拔 session 后端"，是**重度产品化工程**。licode 不必照搬整个自建层，但可低/中成本借鉴其抽象思想。

---

## 一、packages/ai：自建统一 LLM API 设计

### 1.1 整体分形架构（关键目录）

```
packages/ai/src/
├── types.ts            (820行) 所有核心抽象：Api/Provider/Model/Context/Usage/Message/Tool + 各种 Compat
├── models.ts           (944行) Models 集合 + Provider 接口 + createProvider/createModels 实现工厂
├── model-catalog.ts    (27行)  类型级"模型目录扁平化"工具
├── models-store.ts     (45行) 可持久化模型目录 ModelsStore（跨启动缓存动态模型列表）
├── models.generated.ts (121行) 自动生成的"所有内置 provider 模型"聚合
├── api/                (10个 api 实现：anthropic-messages / openai-completions / openai-responses / ...)
│     .lazy.ts          (3行) 每个 API 的动态 import 懒加载入口
├── providers/          (40+ 个 provider 工厂；每个一个 .ts + 一个 *.models.ts)
├── auth/               (认证：apiKey + 大量 OAuth 实现)
└── utils/              (event-stream / retry / provider-retry / error-body / validation / overflow / json-parse ...)
```

**核心设计：把"协议（Api）"与"实体（Provider/Model）"彻底分离。** 一个 provider 可以声明多个 api（如 `Provider<"openai-responses" | "openai-completions">`），同一实现被不同 provider 复用。

### 1.2 核心抽象清单（一句话职责）

| 抽象 | 位置 | 职责 |
|---|---|---|
| `type Api` | types.ts:17-29 | 由已知 `KnownApi` 联合 + `(string &{})` 开放扩展的协议 id；支持第三方自定义 API |
| `type KnownProvider` / `ProviderId` | types.ts:35-75 | 39 个内置 provider + 任意字符串；"已知集 + 开放字符串"双轨 |
| `interface Model<TApi>` | types.ts:784-813 | 统一模型描述：id/api/provider/baseUrl/reasoning/thinkingLevelMap/input/cost/contextWindow/maxTokens/compat |
| `interface Provider<TApi>` | models.ts:97-149 | 运行时单元：id/name/baseUrl/headers/**auth**/getModels()/refreshModels()/filterModels()/stream()/**streamSimple()** |
| `interface Models` | models.ts:156-223 | provider 集合 + auth 解析 + 流式便捷入口；核心 `stream()/complete()/streamSimple()/getAuth()/getAvailable()/refresh()` |
| `createProvider()` | models.ts:762-862 | 从部件拼 provider；支持**单实现或按 api 分派**、动态模型 overlay、deferred 转发 |
| `interface ProviderStreams` | types.ts:267-276 | 每个 `api/` 模块的统一流式契约（stream + streamSimple + fetchDeferred/cancelDeferred） |
| **`StreamFunction`** | types.ts:319-323 | 契约：必须返回 `AssistantMessageEventStream`；失败以事件编码而非抛错 |
| `AssistantMessage` / Usage | types.ts:412-427 / 367-388 | 统一 assistant 消息（content 含 text/thinking/toolCall）+ 统一 token 统计（含 cacheRead/cacheWrite/cost.tiers 分档） |
| `AssistantMessageEvent` | types.ts:515-531 | 统一流事件协议（done/error/text_delta/thinking_delta/toolcall_delta） |
| `interface Context` | types.ts:501-505 | 请求上下文：systemPrompt + messages[] + tools[](TypeBox schema) |
| `OpenAICompletionsCompat` | types.ts:537-597 | **OpenAI 兼容 API 的差异能力开关**（store/developer/thinkingFormat/supportsStrictMode/...） |

### 1.3 多 provider / model fallback / token 统计 / 流式 / 结构化

- **多 provider 路由**：`createProvider` 的 `api` 既可以传单个 `ProviderStreams`，也可以传 `Partial<Record<Api, ProviderStreams>>` 按 `model.api` 分派（models.ts:775-791）。models.ts:254-733 `ModelsImpl` 管理 provider 集合。
- **model fallback / dynamic 目录**：`Provider.refreshModels` 可从远端拉动态模型列表，经 `ModelsStore`（models-store.ts:21-25，可注入持久化）缓存；离线先恢复 cache，联网再刷新（models.ts:386-446）。**同一个 provider 内模型可热更新（baseline + dynamic 合并，models.ts:766-774）**。
- **跨 provider fallback**：pi 的 Provider 层**不内建跨模型 fallback**（那个逻辑在更高层 coding-agent，不在 ai 包）。ai 层只做 provider 内 retry + 把 `allow_fallbacks/order/only` 等传给 OpenRouter/Vercel AI Gateway 路由（types.ts:685-764）。licode 现在的做法（provider.ts:106-132 生成按 PROVIDER_PRIORITY 顺序逐个试）其实更"上层"。
- **重试**：`utils/provider-retry.ts:105-125` `retryProviderRequest` —— 镜像 OpenAI/Anthropic SDK 的 retry 策略（429/408/409/5xx + `x-should-retry` header），但 backoff sleep 可被 AbortSignal 打断。`utils/retry.ts` 是泛型版本。
- **token 统计**：`Usage` 统一含 input/output/cacheRead/cacheWrite/reasoning/totalTokens，cost 含分档 tiers（types.ts:367-388）；`calculateCost()`（models.ts:878-898）实现分档计费（含 Anthropic cache write 2x）。每 API 模块负责把各自原始 usage 规整成统一 `Usage`（例如 openai-completions.ts:456 的 usage 兜底）。
- **流式**：`utils/event-stream.ts:4-67` 的泛型 `EventStream` —— 队列+等待者，支持 push/yield 同步、`result()` 得到最终消息；`AssistantMessageEventStream`（:69-83）以 done/error 事件终止。**流错误不抛异常而是发 error 事件**，`lazy.ts:46-61` 把"异步 setup（auth/懒加载）失败"也编码成 error 事件。
- **结构化输出/工具**：工具用 **TypeBox schema**（types.ts:494-499 `Tool.parameters: TSchema`，及 api/constrained-sampling.ts 的 json_schema/grammar 约束采样）；调用方不强制 schema 输出，而是依赖工具严格模式（strict）与 `utils/validation.ts` 的 tool call 参数校验/类型收敛。

### 1.4 provider adapter 长什么样

极薄工厂，例如 `providers/openai.ts:6-15`：
```ts
export function openaiProvider(): Provider<"openai-responses"> {
  return createProvider({
    id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1",
    auth: { apiKey: envApiKeyAuth("OpenAI API key", ["OPENAI_API_KEY"]) },
    models: Object.values(OPENAI_MODELS),
    api: openAIResponsesApi(),   // 来自 api/openai-responses.lazy.ts（懒加载）
  })
}
```
实现都在 `api/*.ts`（每种协议一个模块），provider 只是"配置 + 选协议"。**一个协议如 openai-completions 支持 openai/deepseek/groq/cerebras/xai/moonshot 等几十家复用**（generate-models.ts 里以 openai-completions 为报告的 provider 一大堆）。

### 1.5 models.generated.ts 怎么生成维护

- 生成脚本 `packages/ai/scripts/generate-models.ts`（超 1500 行，自动生成）。
- 数据源：**models.dev `https://models.dev/api.json`**（权威模型元数据）+ OpenRouter API + NVIDIA NIM + Vercel AI Gateway 实时抓取。
- 处理管道：对每个 provider 定义 `api`、`baseUrl`、`thinkingLevelMap`（映射 pi 统一 thinking 档次到各家 effort）、`compat`（能力开关）、`cost`（含 tiers 分档）、`input` 模态；大量手写 override（例如 Gemini 3 的 `{low:"LOW",high:"HIGH"}`）。
- 输出：每个 provider 一个 `providers/xxx.models.ts`（6 行，import 一份 JSON + `flattenModelCatalog`）+ 共享 `models.generated.ts`（121 行，所有 provider 聚合映射）+ `data/.manifest.json`。
- 维护方式：`npm run generate-models`，新增/修改某个 provider 即改脚本里对应函数。**模型元数据与运行时实现完全分离，靠脚本生成热更新，避免手工维护 catalog。**

### 1.6 自建 vs 第三方 `ai` SDK 的取舍（pi 视角）

**优点（pi 自建换来）**：
1. **可控性/透明性**：流错误不抛改事件、retry 可中断、统一事件流协议 —— 对上层 agent/TUI 稳定。
2. **deep provider 差异覆盖**：`Compat` 开关让同一个 OpenAI-completions 实现去适配 deepseek 的 thinking、moonshot 的 max_tokens、fireworks 的 session-affinity 等，自定义 server (llama.cpp/vLLM) 也能吃 `samplingParams`。
3. **类型精确**：`model.api` 编译期区分；`hasApi()` 运行时收窄。
4. **可画像（OAuth/代理/环境）**：完整 auth 层（apiKey + 9 个 OAuth 实现）。
5. **拉模型目录**：动态目录 + 持久化，开发/unbundled billable。

**缺点（自建代价）：
- 体量巨大（313 个文件、api 实现每协议几百到 1500 行）—— 这是数周~数月工程。
- 代码生成器 dependent on models.dev / 各 API 抓取，需定期跑。
- 每个新 provider/API 变更需自己跟进底层协议细节。

**对比 `ai` SDK v6**：licode 用 ai SDK 自动帮你做不错的流化、供应商适配、工具 schema（Zod），但：
- provider 数量由 ai SDK 的供应商决定，licode 想加 deepseek/minimax 等自拓成本上更不可控（还要自己处理 baseURL/namespace 坑，如 provider.ts:55-93 的 normalizeAnthropicBaseUrl 手工修 /v1）。
- ai SDK 的流式/终止由它定义，licode 的"单一 EXECUTE 阶段"对其不太敏感。

---

## 二、protocol + session-backends + server/client：跨进程 daemon 协议

### 2.1 protocol 包（二进制、结构化、类型安全）

分层：**CBOR 编码 → 4 字节长度前缀分帧 → typebox 校验 schema → 编解码器**。

| 层 | 文件 | 职责 |
|---|---|---|
| CBOR 编码 | `cbor/encoder.ts` `decoder.ts` | 二进制序列化（比 JSON 紧凑） |
| framing | `framing.ts:1-165` | 4 字节 BE uint32 长度前缀+增量拆包，`FrameDecoder` 支持打断（64KB block），默认最大帧 16MB |
| schemas | `schemas.ts:450` | 用 **typebox** 定义 ClientMessage / ServerMessage / SessionSnapshot / TranscriptItem / ... |
| codec | `codec.ts:1-168` | encode+decode：先 `Check()` 校验再 CBOR；增量 `ClientMessageDecoder` |

**协议消息模型**（schemas.ts）：
- 客户端：`ClientHello{version}` + `RequestEnvelope{type:"request",id,request:Command}`，Command = create/attach/detach/prompt/steer/abort/set_model/set_thinking（schemas.ts:291-324 判别联合）。
- 服务端：`ServerHello{snapshot}` / `ResponseEnvelope{ok:bool,result|error}` / `EventEnvelope{type:"event",event:ServerEvent}`（schemas.ts:400-450）。
- 数据传输内容为 **SessionSnapshot**（整个 transcript：user/assistant/tool 三种 item，又分 streaming/complete/error/aborted/running 状态，schemas.ts:120-256）而非流增量；另设 `TranscriptProgress`（item_started / assistant_delta / item_updated / item_finished，schemas.ts:204-229）作为**非权威的增量进度**（snapshot 始终权威）。
- 顶层恒定但类型级互斥：`protocol.ts:24-81` 一堆 `Assert<ExactKeys<...vers6>>` 编译期断言 pi-ai 的字段没漏（新增字段会编译失败）。

### 2.2 session-backends（可插拔存储抽象）

- 包 `session-backends/` 下目前只有 `sqlite-node`（node:sqlite 的 WAL/sync FULL/busy_timeout，repo.ts:171-175）。
- 存储**接口本体不在这个包**，而在依赖 `@earendil-works/pi-agent-core`（node_modules 未安装，源码不在仓库）：`SessionRepo`（create/open/list/delete/fork/close）、`SessionStorage`（session 级：appendEntry/appendRecord/getLog/lanes/facts/stats）与 `Session` 门面。
- sqlite 实现 `SqliteSessionRepository`（repo.ts:654-938）实现该抽象：单层 `SqliteDatabase` 能力抽象（`SqliteDatabase/Factory/SessionRepoEnv`，基本：exec/prepare/transaction/close，types.ts:19-28），其他数据库想接入只写 new 后端实现同一 `SessionRepo` 接口。
- **亮点 1 — 全局 revision + 事件溯源看策略**：每 session 主键 entries + lanerecords + facts 都写序列 `seq` 单调递增，`getLog(afterSeq)` 当增量通道（repo.ts:567-596）——天然交叉进程同步。
- **亮点 2 — writer lease（多进程写安全）**：`writer-leases.ts` + repo.ts:131-136，claim/heartbeat/ttl(30s)，一次一写、lease 丢失即时报错防止分叉。
- **亮点 3 — 分支/分支缓存**：session 概念上是" entry 链 + branch(lane) 指针"，`branch-cache.ts` 缓存 branch 读路径（repo.ts:534-548）。
- **亮点 4 — fork**：`repo.ts:782-894` 支持 scope tree / 指定 entry 分叉、复制 entries+lanes+branch tips。

### 2.3 server/client（daemon 架构）

- server 包：`server.ts:367` 管理连接；`protocol.ts`（给 AI 的字段做协议映射）；`sessions.ts: `LiveSessionManager` 每 command dispatch，维护 live session（跨 connection 共享、owner）；`transports/unix/listener.ts`（unix socket）。
- client 包：`client.ts:51-432` `PiClient` 异步 RPC，请求/响应按 request-id 匹配（`#pendingRequests`），事件订阅（snapshot/progress），**session lease 模型**（共享 vs 独占：session-handle + client.ts:39-60）。`unix.ts` 提供 unix socket ByteTransport。
- 架构图景：多 TUI/CLI/远程进程 bind 到 daemon 上的结构化协议通信，多进程可同时 attach 同一 session。

---

## 三、licode 可借鉴点（pi 怎么做 / licode 现状 / 迁移成本）

### 借鉴点 1：把模型元数据从"手写 catalog"改为"脚本从 models.dev 生成"
- **pi 怎么做**：`npm run generate-models` 抓 models.dev + 各代理，产出 `models.generated.ts` + provider 单独 `.models.ts` + `.manifest.json`，cost/tokenLevelMap/compat 都在脚本里维护。
- **licode 现状**：`packages/llm/catalog.ts` 手写 6 个 provider 常数模型表（provider.ts + catalog.ts，无生成器）；新增模型要手工加。
- **迁移成本**：**低~中**。licode 只有 Anthropic/OpenAI/DeepSeek/MiniMax：现在可先手写扩展；真正自适应生成要搭 `generate-models` 脚本（需要网络拉取 + typebox schema + 到 `ModelConfig` 的对应），属于中小工作量。**若只求覆盖现有 4 家，先不动生成器，把 catalog 改成 typebox-schema + cost 字段即可**。
- **value**：主流模型 word said context/price 自动跟最新；避免 licode 手工 catalog 失效。

### 借鉴点 2：把 `Model` 结构补齐成"成交价/context/thinking/成本分档"的完整描述，并让 `ModelConfig` 泛化
- **pi 怎么做**：Model 含 cost 分档 + contextWindow + maxTokens + thinkingLevelMap；`calculateCost()` 统一计费，`getSupportedThinkingLevels()` 归一化。
- **licode 现状**：model 只有 id出发，`catalog.ts` 每个模型一个条目存 contextWindow，无 thinking 等级、无 cost 分档、usage 由 session 直接算（session.ts、cost.ts 独立）。AI SDK 自带 USB its own cost, 但 licode 未用其 output 计量。
- **迁移成本**：**中**。把 `ModelConfig` 加字段 + `packages/llm/cost.ts` 按分档算价 + `getSupportedThinkingLevels` 概念，逻辑不多但要动 session 里 usage/cost 的持久化字段。价值中等（licode 当前不是 token 计费敏感场景）。

### 借鉴点 3：把"错误模型"统一为"流事件 + 可中止 retry"，而非抛错给上层
- **pi 怎么做**：`AssistantMessageEvent` 的 `done/error/stream_delta`，一切失败（含 setup/auth）编码成 error 事件；`retryProviderRequest` 的 sleep 可被 AbortSignal 打（provider-retry.ts:105-125）。
- **licode 现状**：用 ai SDK `generateText/streamText`，错误靠 catch；`retry-strategy.ts: time` + retry 不能暂停/ abort 语义。provider.ts:110-132 在 createModel 阶段循环 fallback。
- **迁移成本**：**中**（这是 licode 重构要动大的）。但可先小做：封装一个 `streamTextWrapper` 统一把 stream 错误/abort 收敛成事件，`retry` 里接入 AbortSignal。这是 pi 最值得学的"稳健性"。

### 借鉴点 4：session 存储加"事件溯源 + writer lease"（为多进程/多前端准备好）
- **pi 怎么做**：所有 entries/records 都带单调 `seq`，`getLog(afterSeq)` 增量同步；`writer-lease` 保证单写者；session 是 branches(lanes)/branch-cache，支持 fork。
- **licode 现状**：`packages/session/session.ts` 单机 SQLite（bun:sqlite），session/message/parts 三表，无 seq 溯源、无 writer lease、无 event 通道。
- **迁移成本**：**中高**（涉及存储 schema + 并发语义重构）。
- **阶段性低值版**：只是给 messages 加全局自增 id + `updatedAt`，session 包引入"增量拉取"接口，可让 daemon/client 共享时用；不必全量 event-sourcing。**如果 licode 仍单进程*single-TUI"、"daemon 化未来有戏"，可先缓行**。

### 借鉴点 5：如果未来要 daemon/multi-client，用"typebox schema + CBOR + framing"定义协议（前提：有价值才做）
- **pi 怎么做**：`protocol/schemas.ts` 用 typebox（而非手写 TS interface）定义所有 wire 消息，编译期+运行时双重校验；CBOR+length-prefix framing；server 单例 + client `SessionHandle` lease。
- **licode 现状**：纯进程内调用，无 daemon，无协议包。
- **迁移成本**：**高**（要开新包 + 定协议 + 建 server/client + 迁移 TUI 走 RPC）。licode 目前是"单二进制终端工具"，若想支持 多 TUI/远程/跨会话共享 再考虑；纯内部 API 不建议上。
- **可以先低成本试水**：借鉴"snapshot 权威 + progress增量"的 TUI 刷新模式——licode TUI 已经读 session state，把它规整成"快照优先"模型即可。

---

## 四、换"自建统一 LLM 层" vs "保留 ai SDK" —— 明确权衡结论

**建议：保留 `ai` SDK v6，不换 pi 的自建 LLM 层（现在）。**

理由（licode 现状角度）：

1. **开发成本不对称**：pi 自建层 ≈ 313 个 TS 文件、每协议 200-1500 行实现、70+ provider/OAuth、脚本生成 catalog。这是" LLM 集成平台"级别的投入（pi 是把包做产品）。licode 只有 4 家 provider、2 个 @ai-sdk，一次性替换不可指。
2. **ai SDK 已经解决 licode 现阶段全部需求**：多 provider（Anthropic/OpenAI 官方 + 自拓 DeepSeek/MiniMax 走兼容）、streamText/GenerateText、工具（你还在用 / 的 Zod 工具）、用法统计（ai SDK 的 Usage）。licode 没踩的 "流事件正交 / 断点 retry / 分档计费 / OAuth ven" 大多是产品级的 polish。
3. **licode 真正的税在协议/provider 差异**：ai SDK 帮我们 take care 了大部分；licode 只要补齐少量 provider-specific（如现在 provider.ts 里 normalize baseURL、normalize MiniMax 模型名）。

4. **什么条件才值得自建**：
   - (a) provider 数量自插到 10+，远追不上 `@ai-sdk/*`；
   - (b) 需要很多 API 差异开关（thinkingFormat/strict/cache）——这类在 @ai-sdk 基础上反而不利；
   - (c) 需要取消 stream（AI SDK retain）无法表达的事件级控制（断点 / 中间 encoding）；
   - (d) 需要做全链路 telemetry/分档计费 as 产品卖点。
   当前 licode 不落到这四条任何一个"刚需"。

5. **建议的"**中间路线**"（不推翻 ai SDK）**：
   - 在保留 ai SDK 的前提下，把你自己在 ai 上包一层 **抽象" ModelAIClient"**：`request(model, messages, tools, signal) →  { stream, cancel, done }`，把 provider 选择/retry/baseURL 归一化都收敛到这一层（类似 pi 的 Models/P vector's 入口，但内部用 ai SDK）。
   - 之后要加 provider 就是"往 layer 里塞一个 @ai-sdk 实现 + catalog 描述"，不用推翻 SDK。
   - 工作配合 "借鉴点 1/3"：catalog 生成 + 统一错误模型，性价比最高；Session 事件溯源（借鉴点 4）/daemon 协议（借鉴点 5）更晚再评估。

**一句话总结**：pi 的自建 LLM 层是"产品级、可画像、provider 100 家、精确 schema"的高投入方案；licode 用 ai SDK 是"快速、够用、低维护"方案。**当前建议保留 ai SDK，只需向 pi 学"统一 Model 元数据描述、统一错误/流事件、可插拔 storage 抽象、目录生成"这几个低成本的"工程习惯"**，不必学它自建 protocol 或 313 文件的 LLM 堆。

---

## 附：licode 现在想直接抄的 3 个最小步（按性价比）
1. `catalog.ts` 加 `schemaVersion`、给 `Model` + `contextWindow` 已有 → 新增 `input/output cost 分档` + `thinkingLevel`（低）
2. 包一个 `streamTextWrapper`（用 ai SDK 内部实现），把 stream + retry + abort 收敛成" 事件 + 可中断 retry"（借鉴点 3，低-中）
3. 给 `session` 处理 messages/parts 加 `seq` + `updatedAt`，提供 `getIncremental(afterSeq)` 增量读取接口（借鉴点 4-先行版，中）
