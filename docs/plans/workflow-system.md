# Workflow 系统设计

**版本**: v0.1.0
**日期**: 2026-06-20
**参考**: mimo-code workflow, opencode V2

---

## 1. 为什么需要 Workflow

### 现状问题

licode 的七阶段（OBSERVE→THINK→PLAN→BUILD→EXECUTE→VERIFY→LEARN）是**硬编码在 `loop.ts` 中**的：

```typescript
// 现在：流程写死在代码里
const PHASE_ORDER = ['OBSERVE', 'THINK', 'PLAN', 'BUILD', 'EXECUTE', 'VERIFY', 'LEARN']
for (const phase of PHASE_ORDER) {
  switch (phase) {
    case 'THINK': return think(ctx)
    case 'PLAN':  return plan(ctx)
    ...
  }
}
```

这导致：
1. **不能换场景**——写代码用七阶段，做研究也用七阶段，写文档也用七阶段。但不同场景需要的流程完全不一样
2. **不能自定义**——用户想加个"自动 backup"步骤，只能改代码
3. **七阶段本身也不对**——BUILD 和 EXECUTE 的区分在实际使用中没有意义

### 目标

**把流程定义从代码中解耦出来，变成可配置、可扩展的脚本。**

```
┌────────────────────────────────────────────────┐
│  Workflow（脚本化流程定义）                      │
│  - 定义有哪些阶段                                │
│  - 定义阶段间的切换条件                          │
│  - 定义每个阶段的行为                            │
├────────────────────────────────────────────────┤
│  Engine（执行引擎，当前 loop.ts 改造）           │
│  - 加载 workflow 脚本                           │
│  - 按脚本定义执行阶段                            │
│  - 提供 agent() / parallel() / tool() 等原语    │
│  - 不关心"下一步去哪"，由 workflow 脚本决定       │
└────────────────────────────────────────────────┘
```

---

## 2. 架构设计

### 2.1 分层

```
┌─────────────────────────────────────────────┐
│                 Workflow 系统                 │
│                                              │
│  ┌───────────────────────────────────────┐   │
│  │  Step 1: 定义 Workflow Script         │   │
│  │  用户/workflow 工具 → 一段 JS 脚本    │   │
│  │  脚本描述了整个流程                    │   │
│  └───────────────────────────────────────┘   │
│                     ↓                        │
│  ┌───────────────────────────────────────┐   │
│  │  Step 2: Workflow Engine              │   │
│  │  解析脚本 → 执行阶段 → 管理状态       │   │
│  │  提供 agent() / parallel() / tool()   │   │
│  │  phase() 标记当前阶段                 │   │
│  └───────────────────────────────────────┘   │
│                     ↓                        │
│  ┌───────────────────────────────────────┐   │
│  │  Step 3: Loop（现有改造）             │   │
│  │  执行具体步骤：工具调用、LLM 调用      │   │
│  │  不再关心阶段切换                     │   │
│  └───────────────────────────────────────┘   │
│                     ↓                        │
│  ┌───────────────────────────────────────┐   │
│  │  Step 4: Tools & LLM                 │   │
│  │  底层能力层                           │   │
│  └───────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

### 2.2 与现有架构的关系

```
Before:                          After:
┌──────────┐                    ┌──────────────┐
│ loop.ts  │                    │ Workflow     │
│ 七阶段   │                    │ Script       │
│ 硬编码   │                    │ (可配置)      │
└──────────┘                    └──────┬───────┘
                                       │ 加载并执行
                                  ┌────┴───────┐
                                  │ Engine     │
                                  │ (新)       │
                                  │ 执行脚本   │
                                  │ 管理状态   │
                                  └────┬───────┘
                                       │ 调原语
                                  ┌────┴───────┐
                                  │ Loop (改造) │
                                  │ 单步执行   │
                                  │ 不关心流程 │
                                  └────────────┘
```

---

## 3. Workflow 脚本规范

### 3.1 格式

Workflow 是一个**导出的 JS 对象**，包含 `meta` 和 `run` 函数：

```javascript
// coding-workflow.js — 编码工作流
export const meta = {
  name: "coding",
  description: "标准编码工作流：分析 → 编码 → 验证",
  whenToUse: "日常开发任务",
  phases: [
    { title: "分析", detail: "理解需求、分析代码" },
    { title: "编码", detail: "生成代码、工具调用" },
    { title: "验证", detail: "编译检查、测试、审查" },
  ],
}

export async function run(ctx) {
  const { agent, tool, log, phase, args } = ctx

  // 阶段 1: 分析
  phase("分析", "理解需求并分析现有代码")
  const analysis = await agent(`分析以下需求并制定方案：\n\n${args.input}`)
  log(`分析完成: ${analysis.slice(0, 200)}`)

  // 阶段 2: 编码
  phase("编码", "执行代码修改")
  const tools = [
    tool("read", { path: args.files?.[0] || "." }),
    tool("edit", { path: "...", oldString: "...", newString: "..." }),
    tool("write", { path: "...", content: "..." }),
  ]
  // 让 LLM 决定具体怎么改
  const code = await agent(`根据方案执行编码：\n${analysis}\n\n使用可用工具完成修改。`)

  // 阶段 3: 验证
  phase("验证", "编译检查和测试")
  const compileCheck = await tool("bash", { command: "npx tsc --noEmit --skipLibCheck" })
  if (!compileCheck.success) {
    log(`编译失败，退回编码阶段: ${compileCheck.error}`)
    // 直接在脚本中控制流程
    return await fixAndRetry(ctx, analysis)
  }
  
  const testResult = await tool("bash", { command: "bun test" })
  log(`测试结果: ${testResult.output?.slice(0, 500)}`)

  return { success: true, summary: "编码完成" }
}

async function fixAndRetry(ctx, analysis) {
  // 子流程：修复错误
  return { success: true, summary: "修复后完成" }
}
```

### 3.2 关键原语（Engine 提供）

| 原语 | 签名 | 说明 |
|---|---|---|
| `agent` | `agent(prompt: string, opts?) => Promise<string>` | 派发一个子 agent，返回结果文本 |
| `tool` | `tool(name: string, input: any) => Promise<ToolResult>` | 执行一个工具调用 |
| `phase` | `phase(title: string, detail?: string) => void` | 标记当前阶段，用于进度显示 |
| `log` | `log(msg: string) => void` | 输出日志 |
| `parallel` | `parallel(thunks: (() => Promise<any>)[]) => Promise<any[]>` | 并发执行多个任务 |
| `pipeline` | `pipeline(items: any[], ...stages: Function[]) => Promise<any[]>` | 流水线处理 |
| `workflow` | `workflow(nameOrScript, args?) => Promise<any>` | 调用另一个 workflow（嵌套） |
| `args` | `args: any` | 传入的参数 |

### 3.3 内置 Workflow

#### coding（默认，替代七阶段）

```javascript
export const meta = {
  name: "coding",
  description: "标准编码工作流",
  phases: [
    { title: "分析", detail: "理解需求" },
    { title: "编码", detail: "代码生成" },
    { title: "验证", detail: "编译和测试" },
  ],
}
```

三个阶段，每个阶段内部调用 `agent()` 和 `tool()`。验证失败自动回退。

#### research（研究模式）

```javascript
export const meta = {
  name: "research",
  description: "研究模式：搜索、阅读、总结",
  phases: [
    { title: "搜索", detail: "搜索相关信息" },
    { title: "阅读", detail: "阅读关键页面" },
    { title: "总结", detail: "输出总结报告" },
  ],
}
```

#### review（代码审查）

```javascript
export const meta = {
  name: "review",
  description: "代码审查：审查未提交的变更",
  phases: [
    { title: "获取变更", detail: "git diff" },
    { title: "审查", detail: "逐文件审查" },
    { title: "报告", detail: "输出审查意见" },
  ],
}
```

---

## 4. Engine 设计

### 4.1 核心接口

```typescript
class WorkflowEngine {
  constructor(config: {
    maxConcurrentAgents: number
    maxDepth: number
    timeoutMs: number
  })

  // 运行一个 workflow
  async run(input: {
    script: string           // 内联脚本
    args: any                // 传入参数
    cwd?: string
  }): Promise<WorkflowResult>

  // 运行内置 workflow
  async runBuiltin(input: {
    name: string             // "coding" | "research" | "review"
    args: any
  }): Promise<WorkflowResult>
}

interface WorkflowResult {
  success: boolean
  output?: string
  error?: string
  phases: PhaseRecord[]
  duration: number
  tokenUsage: { input: number; output: number }
}
```

### 4.2 执行流程

```
1. 解析脚本 → 提取 meta 和 run 函数
2. 创建沙箱执行环境
3. 注入原语（agent/tool/phase/log/parallel/pipeline）
4. 执行 run(ctx)
5. 收集结果（阶段记录、token 使用、耗时）
```

### 4.3 沙箱

Workflow 脚本在**受限的沙箱**中执行：

```typescript
const sandbox = {
  // 允许访问的全局对象
  console: { log: () => {}, warn: () => {}, error: () => {} },
  Promise,
  setTimeout,
  clearTimeout,
  // 禁止访问
  // process, require, fs, fetch 等都不暴露
}
```

原语由 Engine 注入，不暴露底层系统权限。

```
sandbox 中的脚本
  ↓ 调 agent(prompt)
    ↓ Engine 创建子 agent（实际是 LLM 调用）
      ↓ 返回结果文本
  ↓ 调 tool(name, input)
    ↓ Engine 调用 globalToolRegistry.execute()
      ↓ 返回执行结果
```

---

## 5. 与 TUI 的集成

### 5.1 进度显示

Workflow 的 `phase()` 调用会：
1. 触发 `onPhaseChange` 回调
2. TUI 侧栏显示当前阶段和进度
3. 斜杠命令菜单显示可用 workflow

### 5.2 使用方式

**用户输入**：
```
做 xxx
  ↓
自动加载 default workflow（coding）
  ↓
执行分析 → 编码 → 验证
```

**或显式指定**：
```
/workflow research 帮我查一下 Bun 的 SQLite API
  ↓
执行搜索 → 阅读 → 总结
```

**或 LLM 触发**：
```
LLM 判断 "这是研究任务" → 自动选择 research workflow
```

### 5.3 /workflow 命令

| 命令 | 行为 |
|---|---|
| `/workflow` | 列出可用 workflow |
| `/workflow coding` | 切换到 coding workflow |
| `/workflow research 主题` | 用 research workflow 执行 |
| `/workflow list` | 显示所有内置 + 自定义 workflow |

---

## 6. 实施计划

### 阶段一：Engine 核心（P0）

| 步骤 | 文件 | 内容 | 预估 |
|---|---|---|---|
| 1 | `packages/workflow/engine.ts` | WorkflowEngine 类：加载、执行、沙箱 | 200 行 |
| 2 | `packages/workflow/types.ts` | 类型定义 | 50 行 |
| 3 | `packages/workflow/index.ts` | 导出 | 10 行 |
| 4 | `packages/workflow/builtin/` | 内置 workflow 脚本 | 100 行 |

### 阶段二：原语实现（P0）

| 原语 | 说明 |
|---|---|
| `agent()` | 调 LLM + 工具循环（复用 execute.ts） |
| `tool()` | 调 globalToolRegistry.execute() |
| `phase()` | 触发回调，通知 TUI |
| `parallel()` | 并发执行，Promise.all |
| `pipeline()` | 串行流水线 |

### 阶段三：改造 Loop（P1）

| 改动 | 说明 |
|---|---|
| `loop.ts` | 删除七阶段硬编码，改为执行 Engine 的当前步骤 |
| `CoreLoop.run()` | 改为 `load workflow → Engine.run()` |

### 阶段四：内置 Workflow（P1）

| Workflow | 替代 |
|---|---|
| `coding` | 替代现在的七阶段 |
| `research` | 新增 |
| `review` | 新增 |

### 阶段五：TUI 集成（P2）

| 功能 | 说明 |
|---|---|
| 侧栏显示当前 workflow 和阶段 | 已有 phase 显示 |
| `/workflow` 命令 | 切换和列出 |
| 自定义 workflow 加载 | 从 `~/.licode/workflows/` 加载 |

---

## 7. 与现有代码的关系

### 保留的

| 模块 | 处理 |
|---|---|
| `packages/core/phases/` 各阶段 | 保留各自的逻辑函数，作为 workflow 中 agent() / tool() 的内部能力 |
| `packages/tools/` | 不变，Engine 的 tool() 调用它 |
| `packages/session/` | 不变 |
| `packages/core/loop.ts` | 改造，不再硬编码阶段循环 |

### 删除的

| 文件 | 内容 |
|---|---|
| `packages/core/loop.ts` 中的 `PHASE_ORDER` | 不再需要 |
| `packages/core/loop.ts` 中的 `executePhase()` | 不再需要 |
| `packages/core/phases/index.ts` | 可能不需要了 |

### 新增的

| 文件 | 内容 |
|---|---|
| `packages/workflow/engine.ts` | Engine 核心 |
| `packages/workflow/types.ts` | 类型 |
| `packages/workflow/index.ts` | 导出 |
| `packages/workflow/builtin/coding.js` | 内置 coding workflow |
| `packages/workflow/builtin/research.js` | 内置 research workflow |
| `packages/workflow/builtin/review.js` | 内置 review workflow |
| `packages/tools/workflow.ts` | `/workflow` 工具 |

---

## 8. 迁移策略

不一次性替换，而是**逐步迁移**：

1. **先加 Engine** — 新模块，不影响现有代码
2. **写第一个 workflow（research）** — 新功能，用新架构
3. **把 coding workflow 写成七阶段的等价物** — 对比测试
4. **验证通过后切换默认** — `loop.ts` 默认走 workflow
5. **保留旧七阶段作为 fallback** — 万一有问题可回滚

---

## 9. 总结

| 维度 | 现在 | 改造后 |
|---|---|---|
| 流程定义 | 硬编码在 loop.ts | JS 脚本，可配置 |
| 阶段切换 | for 循环 + switch | 脚本控制，`phase()` |
| 多场景支持 | 无 | 内置 coding/research/review |
| 用户自定义 | 改代码 | 写 workflow 脚本 |
| 子 agent 编排 | 未使用 | `agent()` / `parallel()` / `pipeline()` |
| 沙箱安全 | 无 | 受限沙箱执行 |
