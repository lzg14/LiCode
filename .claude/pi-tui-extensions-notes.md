# pi 的 TUI + Extensions/Skills 研究笔记（licode 借鉴用）

> 研究对象：`D:/ProjectFile/pi/packages/tui`（differential-rendering 终端 UI 库，77 个 ts 文件）、`packages/coding-agent`（extensions / skills / prompt-templates / themes 自扩展系统，以及其大型状态管理手法）。
> 对比对象：`D:/ProjectFile/licode`，其 TUI 用 SolidJS + @opentui，核心状态在 `packages/tui/context/loop.tsx`（961 行 god component）。
> 结论一句话：**pi 自己也有 5774 行的 InteractiveMode god class，但它不把"状态/业务"和"UI/渲染"混在一起** —— 业务状态下沉到 `AgentSession`（事件驱动），UI 层只管"把事件映射成组件树"，外加一层统一资源加载器 `DefaultResourceLoader`。这是比"把 loop.tsx 拆成多个 context"更本质的解耦。本文给出可直接落地的拆法。

---

## 1. packages/tui：differential rendering 实现

### 关键文件 + 行号
| 文件 | 职责（一句话） |
|---|---|
| `src/tui.ts` (1256) | 引擎内核：`TuiBase extends Container`，定义 `Component` 接口 `render(width): string[]`（**先渲成字符串行数组，不直接碰终端**）、overlay 栈、焦点管理、输入监听、渲染调度（`requestImmediateRender`/`requestRender` 16ms 节流）。 |
| `src/tui-main-screen.ts` (586) | **普通屏差分渲染**：`doRender()` 计算 `firstChanged/lastChanged`，只重写改变的行；处理 scrollback、viewport、kity 图片、硬件光标定位。 |
| `src/tui-alt-screen.ts` (825) | 备用屏（全屏）差分渲染 + ScrollView 布局 + 鼠标/选择/滚动条/URL 点击。 |
| `src/layout.ts` (369) | 布局引擎：从组件树算出 `LayoutFrame`（每组件 rect/clip/scrollContentLines），供鼠标/选择/滚动命中测试使用。 |
| `src/components/scroll-view.ts` (171) | 可滚动的"文档→视口"映射容器（`scrollTop/isFollowingEnd/overscroll`）。 |
| `src/components/editor.ts` (2008) | 大块头：多行输入编辑器 + autocomplete + markdown 首几行高亮。 |
| `src/utils.ts` (1183) | 行/宽/ANSI 段切分：`visibleWidth`、`sliceByColumn`、`extractSegments`、`compositeTuiLine`（overlay 与 base 按列合成）。 |
| `src/terminal.ts` (466) | Terminal 抽象（读写转义序列、raw mode、title、progress）。 |
| `src/tui.ts` Component接口 (`tui.ts:23-47`) | 一切组件的契约。含 `render(width)`、`handleInput`、`invalidate`、`wantsKeyRelease`。 |

### 差分渲染是怎么做的（核心机制）
1. **组件不直接写终端**，而是 `render(width)` 返回 `string[]`（每行 = 一个待输出的终端行，含 ANSI）。
2. `TuiMainScreen.doRender()` (`tui-main-screen.ts:180`) 拿新行数组，与 `previousLines` **逐行 diff**，找出 `firstChanged/lastChanged` (`:295-320`)，只对改变的行发 `\x1b[{row};1H\x1b[2K{line}`。
3. **同步化输出**：整段包在 `\x1b[?2026h ... \x1b[?2026l`（synchronized output），避免闪烁。
4. **什么时候退化为全量重画** (`fullRender`)：首帧、宽度变化（换行重排）、高度变化（Termux 除外）、内容收缩超过历史高水位、firstChanged 滚出视口之上。**退化全量重画是耐心堆出来的正确性兜底**，不是把每行都 delta。
5. 硬件光标：组件在输出里埋 `CURSOR_MARKER`（APC 序列 `\x1b_pi:c\x07`，`tui.ts:79`），渲染后 `extractCursorPosition` 搜 marker 定位，供 IME 候选窗。这是 @opentui 没有的（licode 依赖 JS 虚拟光标）。

### 与 licode/@opentui 的架构差距，值得学
- **@opentui 是 DOM-like 虚拟树 + Solid 响应式**：组件是 reactive 的，diff 由框架虚拟树做，开发者声明 `<Box><Text/></Box>`。
- **pi 是"命令式组件 + 手搓字符串差分"**：`Component.render(width)` 是纯函数式、无框架依赖，组件树用 `Container.addChild/removeChild` 手动拼。它没有虚拟 DOM，也没调度器，渲染调度就是 TuiBase 里的 16ms 节流 + input 命中时 `requestImmediateRender`。
- **可借鉴点**：pi 把**"前一次渲染结果"作为状态存起来做最小 diff**（不管渲染框架多智能，终端是线性字符流，最小重写永远有收益）。licode 用 @opentui 虽然是响应式，但没有利用"留存上一屏"做差分裁剪——可用 `setClearOnShrink` + 手写 changed-line 判定绕过 @opentui 全量 flush。但**非核心，licode 不必移植整套**。

---

## 2. coding-agent 的 extensions / skills / prompt-templates / themes

### 2.1 Extensions（TS 模块自扩展，核心）
| 文件 | 一句话职责 |
|---|---|
| `src/core/extensions/types.ts` (1465+) | **全部类型定义**：`ExtensionAPI`（event on / registerTool / registerCommand / registerShortcut / registerFlag / registerProvider / 消息渲染器等）、`ExtensionContext`/`ExtensionUIContext`（UI 原语）、`ExtensionEvent` 判别联合（30+ 事件）。 |
| `src/core/extensions/loader.ts` (737) | 用 **jiti** 动态 import TS 扩展并 `createExtensionAPI` 注入；内置 `VIRTUAL_MODULES`/`getAliases` 让扩展 import `@earendil-works/pi-*` 时拿到与主程序同一份实例。Discovery 规则：目录下直接 `*.ts|js`；子目录要有 `index.ts` 或 `package.json` 的 `pi.extensions` 字段。 |
| `src/core/extensions/runner.ts` (1116) | ExtensionRunner：绑定 runtime 的 action 方法（sendMessage等），把 `ExtensionEvent` 派发给所有扩展的 handler，聚合各 handler 结果（如 `before_agent_start` 的 systemPrompt 链式覆盖、`tool_call` 的 block）。还处理 keybinding 冲突、provider 注册入 model-registry。 |
| `src/core/extensions/wrapper.ts` (41) | 给 built-in 工具包一层 `Extension/ReResult` 兼容壳，让普通工具与扩展工具用同一套 `ToolResultEvent` 类型。 |
| `src/core/extensions/index.ts` (186) | 纯 re-export 面，无逻辑。 |

**Extensibility 设计精髓**
- **事件驱动，而非硬编码**：扩展只 `api.on("tool_call", ...)`。与 licode 的 skills（只能在 system prompt 注入文本）相比，pi 的扩展能**改工具参数、block 工具、改 system prompt、自定义 UI 组件、注册 CLI flag、注册整个 provider**。`ExtensionEvent` 是个判别联合，`ExtensionHandler<E,R>` 泛型让每个事件绑定其结果类型。
- **Context 三件套**：`ExtensionAPI`（注册用，扩展作者 import）、`ExtensionContext`（只读+UI 原语）、`ExtensionCommandContext`（含 session 控制）。用"只给最小够用面"降低耦合。
- **bundle 一致性**：`VIRTUAL_MODULES` 把 `@earendil-works/pi-*` 静态打包进二进制，扩展里的 `import @earendil-works/pi-tui` 拉到同一份，共享 `theme`、注册表、TUI 组件类型——避免重复实例。
- licode 可借鉴：新扩展 = **事件订阅 + registerX 注册表**，而不是注入文本。licode skills 目前只能("加载 SKILL.md → system prompt + auto-suggest")；可加一个 `ExtensionEvent` 的最小集合（`before_turn`/`tool_call`/`message_update`），让 skill 不只在 prompt 里，还能回调。

### 2.2 Skills（Agent Skills 规范实现）
文件：`src/core/skills.ts` (487)。` Skills` 不是黑箱：`loadSkillsFromDir` 遵循 Agent Skills discovery（目录内 `SKILL.md` 才算 skill 根，否则取直接 `.md` 子文件，递归找）；`parseFrontmatter` 读 `name/description/disable-model-invocation`；`loadSkills` 合并 user（`agentDir/skills`）、project（`cwd/.pi/skills`）、显式路径三来源，并做 **重名 collision 诊断**（`diagnostics.ts`，资源名冲突有 winner/loser + sourceInfo）。
`formatSkillsForPrompt` 输出标准 XML `<available_skills><skill>…`，指导模型"用 read 工具去读 SKILL.md 文件"，**而不是把整个 skill 内容注入 system prompt**（节省 token）。licode 是"注入指令进 prompt"，pi 是"**注入元数据 + 让模型按需 read 加载内容**"——更省 token，也更符合 Agent Skills 标准。

### 2.3 Prompt Templates
文件：`src/core/prompt-templates.ts` (285)。prompts 目录里每个 `.md` 是一个模板（frontmatter 的 `description/`argument-hint`），body 支持 bash 风格 `$1/$2/$@/${N:-default}/${@:N:L}` 变量替换（`substituteArgs` :70）。运行时 `/name args` 展开成内容（`expandPromptTemplate`）。这比 licode 的 `/` 斜杠菜单更"可数据化"——**一个 .md 文件定义一个 /命令 及其参数展开**，无代码。

### 2.4 Unified Resource Loader（把四类统一，licode 最该学）
文件：`src/core/resource-loader.ts` (978)。**核心抽象**：`DefaultResourceLoader` 把 **skills + prompt-templates + themes + extensions** 一起 `load()` 并统一诊断（`ResourceDiagnostic`：warning/error/collision），提供 `getSkills()/getPrompts()/getThemes()/getExtensions()`，且支持运行时 `/reload` 重载。`getExtensions()` 内部 `extension.runner` 派发扩展并维护名空间。
> 这正是 licode 现在最缺的：**licode 的 skills loader、tools registry、config、主题 是各管各的独立模块**。pi 用一个 ResourceLoader 把它们捆绑成一个"可 reload 的资源生命周期"。

---

## 3. 大型状态管理手法 + licode loop.tsx (961) 拆法

### 3.1 pi 怎么组织大型状态（即使 InteractiveMode 5774 行也不失控）
| 手法 | pi 表现 |
|---|---|
| **业务状态 != UI 状态** | `AgentSession` (2981 行，`core/agent-session.ts`) 持有消息、run/prompt/compact/compaction 状态，只 `emit(AgentSessionEvent)` 判别联合 (`agent-session.ts:141-186`)。`InteractiveMode` 只管**订阅这些事件 → 更新组件**。它**绝不在 UI 类里直接拼 LLM 上下文或调 provider**。 |
| 分层依赖单向 | `main.ts / cli → runtime → interactive-mode →（订阅）AgentSession → extensionRunner → extension`。UI 反向不碰 provider/session 写逻辑。 |
| 事件总线两条"线" | 8：内部用 `AgentSessionEvent`（本地 type 联合），扩展握手用 `extensions/event-bus.ts`（node EventEmitter + 每个 handler try/catch）。UI 通过订阅拿到状态，不共享可变 store。 |
| 构建 -DI | `agent-session-services.ts` 用 `createAgentSessionServices` 组装 `modelRuntime/settingsManager/resourceLoader`，测试注入一条龙。 |
| 组件保持小 | 即使 5774 行 InteractiveMode，但 UI 组件全在 `modes/interactive/components/` 分开（`assistant-message` / `tool-execution` / `footer` / 各种 selector / `status-indicator` / `skill-invocation-message` 各一个文件），`interactive-mode.ts` 更多是"编排 + 事件 → 建组件树"，唯独它自己别拆太碎，因为组装本身就是一体机。 |

### 3.2 显而易见的结论
- pi 的 `interactive-mode.ts` 行数比 licode 的 `loop.tsx` 还多 6 倍，**god 类本身不是问题**；问题是 loop.tsx 里同时混了：MCP 初始化、session恢复解析、skill 建议 async、流式防抖（2 个 flush timer）、subagent 跟踪、scheduler、input queue、图片解析、tool-call 轮次 confirm、compaction 回调……**职责过多 → 每一个都藏着状态和生命周期**。
- pi 的 loop 能长而可控，因为它把"业务/AI 状态"剥给了 `AgentCore` / `DefaultActivityLoop`，`InteractiveMode` 剩下的是**纯 UI 化事件处理**，可读性靠小文件组件 + 明确命名。
- licode 缺的比"拆 880 行"更前置的是：**根本没有一个独立的"Session/AI 状态对象"**，`loop.tsx` 本身就是。第一步是把共享/派生状态抽出去。

### 3.3 loop.tsx 具体拆法（可落地，逐步、可回归）
目标：把 loop.tsx（880 行，961）从"一个 provider 干所有"拆成一棵树，**无关 prop**.

**阶段 A：抽可独立上下文（先验拆分，成本低、回退安全）**
1. `context/loop-input.tsx` — `inputQueue`、`pendingCount`、`run` 的队列/confirm 逻辑（`loop.tsx:164,169,500-535,791-799`）+ `abort`（SIGINT handler + 队列清空，`200-245`）。Provider → 提供 `run/abort/isProcessing/pendingCount/signal`。
2. `context/loop-stream.tsx` — 流式：`streamingSegments/pendingText/streamMode`/stream-accumulator + 两个防抖 timer（`485-513`）。导出 `pushStream(delta)` / `flushStream()` / `resetStream()`。
3. `context/loop-model.tsx` — `currentModel/currentProvider/switchModel/switchProvider/getAvailableModels`（`352-384`）。只碰 `activeModel`/`llmConfig`。
> 上面三个是"别人不需要看全貌、但自己在子树用"的；用 `createContext` 独立 export，`useLoop` 保留成组合。

**阶段 B：抽旁路状态（单例成效用，不进 JSX）**
- `context/subagent-tracker.ts` — `subagentStatuses/subagentOpen/setSubagentOpen` 挪出，提供 `startSubagent(id,task)/endSubagent(id,ok)`。loop.tsx 只留 `onSubagentStart/onSubagentEnd` 两个调用点。
- `context/loop-scheduler.ts` — `addLoop/stopLoops/listLoops/scheduler`（`858-895`）整体搬到独立 context，loop.tsx 只放 `scheduler` 引用。
- `context/loop-skill.ts` — `activeSkill/activeSkillInstructions/setActiveSkill/listSkills/pendingSkillSuggestion/skillSuggestIdx/resolveSkillSuggestion`（`147-162,320-350,543-577`）——skill 建议是 10s 等待 modal 交互，与 `run` 主流程解耦，值得独立。

**阶段 C：把"大 run 闭包"抽成类/复用件（这是解决 961 行的根）**
- 把 `run()` 里那一大段（`loop.tsx:594-799`）抽成 `useAgentTurn()` hook：接收 `{userInput, images, signal}`，内部在生命周期里管理 `isProcessing/elapsed/prelapsed/abortController/toolCallCounter/toolStartTimes/confirmResolve/verifyResults/phase`，通过冒泡回调返回 `onStream`/`onToolCall`/`onSubagent`/`onCompaction`。
- 这样 loop.tsx 只剩"拼回调 → 交给 `runAgentTurn` → 同步到各处 context + message-list"，从 **961 行降到 ~250 行**，可单测。
- MCP 初始化（`loop.tsx:252-318`）抽到 `integration/mcp/plugin.ts`，在 root 初始化一次（不要在 loop 里 `initMCP()`），返回注册后的 closed list，loop 只保存引用。**这会打破"MCP 活在上下文里"的隐式耦合**。

**阶段 D（弹性）重命名/重构高行数组件待定**
- 若仍超 300，再抽 `Message` 列表引擎；但**不要为了小而行变态 split**。

### 3.4 与 pi 的映射：如果照 pi 抄，最终形态
```
licode/
  context/loop.tsx            # 之后薄成 Coordinator（订阅 + assembly），去掉所有"逻辑"
  context/loop-input.tsx      # 输入队列 + abort + SIGINT
  context/loop-stream.tsx     # 流式 + 防抖
  context/loop-model.tsx      # 模型切换
  context/loop-skill.tsx      # skill 建议 + activeSkill
  context/loop-scheduler.tsx  # scheduler
  context/loop-tools.tsx      # (可选) tool 展开/timing
```
**mirror** pi 的做法更序：`loop.tsx` 应当更像 `interactive-mode.ts`：本来是"编译每个消息 → 更新组件"的输出，而真正"AI 状态"应该放进一个 `AgentSession`-like 类（能从 `packages/core/loop.ts` 抽出来），或是继续保持"`loop.tsx` 用自己的小 context 状态"——取决于你打算把 session 深度多富。

### 3.5 强提醒/避免踩坑
- **不要在拆分时顺手"重构润色"**（全局 CLAUDE.md 的精修改守则）；拆分目标是**保持行为完全不变**，只动结构。
- 每次拆完跑 `bunx tsc --noEmit --skipLibCheck && bun test packages/tui`。
- `createContext` 从 Solid 引入成本低，拆分私有 Context 比单 context 传播更优（避免把一坨传给无关树）。

---

## 附：path→行号速查
- pi `tui.ts` 引擎：差分核心 `tui-main-screen.ts:180-547`、全屏 `tui-alt-screen.ts:826-889`
- pi ext 核心 API 类型：`extensions/types.ts:1198-1436`（ExtensionAPI）
- pi ext loader：`extensions/loader.ts:436-464`（jiti import）、`652-737`（discovery+load）
- pi ext runner：`extensions/runner.ts`（bind 方法 + 事件派发在 1116 行内）
- pi ResourceLoader：`resource-loader.ts`（`getSkills/getPrompts/getThemes/getExtensions`、`reload`）
- pi 分层装配：`agent-session.ts:305`（AgentLoop）、`agent-session-runtime.ts`、`agent-session-services.ts:73`（注入点）
- licode loop.tsx：run `515-799`、输入队列 `169,500-535`、流防抖 `485-513`、MCP `252-318`、skill 建议 `543-574`、subagent `694-703`、scheduler `858-895`、model `352-384`
