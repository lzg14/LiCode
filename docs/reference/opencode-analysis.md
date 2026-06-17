# opencode 架构分析笔记

**版本**: v1.0.0
**日期**: 2026-06-17

---

## 1. opencode 项目结构

```
opencode/
├── packages/
│   ├── core/              # 核心逻辑
│   ├── opencode/          # CLI + 主程序
│   ├── tui/                # 终端 UI
│   ├── desktop/            # 桌面应用
│   ├── app/                # Web 应用
│   └── ...
├── specs/
│   └── v2/                 # V2 架构文档
│       ├── session.md
│       ├── tools.md
│       ├── config.md
│       ├── provider-model.md
│       └── ...
└── ...
```

---

## 2. 核心模块（packages/opencode/src/）

| 目录 | 说明 |
|------|------|
| `agent/` | Agent 定义和配置 |
| `session/` | Session 管理和处理器 |
| `tool/` | 工具注册和执行 |
| `provider/` | LLM Provider 抽象 |
| `permission/` | 权限系统 |
| `skill/` | Skill 系统 |
| `plugin/` | 插件系统 |
| `mcp/` | MCP 集成 |
| `workflow/` | 工作流引擎 |
| `task/` | Task 任务管理 |
| `actor/` | Actor 调度 |

---

## 3. V2 Session 架构（specs/v2/session.md）

### 3.1 核心概念

| 概念 | 说明 |
|------|------|
| **Context Epoch** | 上下文周期，拥有 baseline + snapshot |
| **Baseline System Context** | 不可变的初始上下文 |
| **Mid-Conversation System Message** | 变更时的持久化消息 |
| **Snapshot** | 用于比较变更的隐藏状态 |

### 3.2 Session 生命周期

```
用户输入 → Admit → Safe Boundary → 上下文变更 → LLM 调用
```

### 3.3 Compaction

- 每次 provider turn 前检查 context budget
- 超过限制时触发 compaction
- 生成结构化摘要，替换历史消息

---

## 4. V2 Tools 架构（specs/v2/tools.md）

### 4.1 工具类型

```typescript
type Definition<Input, Output>
type AnyTool = Definition<any, any>
```

### 4.2 执行流程

1. 解析工具名称
2. 解码输入
3. 调用 execute
4. 编码输出
5. 投影为 content
6. 截断限制
7. 返回 settlement

---

## 5. Provider/Model 架构（specs/v2/provider-model.md）

### 5.1 支持的 Provider

| Provider | 说明 |
|---------|------|
| openai | OpenAI GPT 系列 |
| anthropic | Claude 系列 |
| google | Gemini 系列 |
| openrouter | OpenRouter |
| azure | Azure OpenAI |
| bedrock | AWS Bedrock |

### 5.2 Model Catalog

```typescript
interface ModelCatalog {
  getModel(providerID, modelID): ModelInfo
  listModels(): ModelInfo[]
  listProviders(): ProviderInfo[]
}
```

---

## 6. Config 架构（specs/v2/config.md）

### 6.1 配置层级

- 全局配置：`~/.opencode/config.json`
- 项目配置：`./.opencode/config.json`
- 命令行参数

### 6.2 配置项

| 配置项 | 说明 |
|--------|------|
| `agent` | Agent 配置 |
| `provider` | Provider 配置 |
| `model` | Model 配置 |
| `permission` | 权限规则 |
| `tools` | 工具配置 |

---

## 7. Agent 类型

| Agent | 类型 | 说明 |
|-------|------|------|
| build | primary | 主执行 Agent |
| plan | primary | 只读计划模式 |
| general | subagent | 通用任务 |
| explore | subagent | 代码探索 |
| compaction | subagent | 上下文压缩 |
| title | subagent | 标题生成 |
| summary | subagent | 摘要生成 |

---

## 8. Workflow 系统

### 8.1 工作流脚本

```typescript
export const meta = {
  name: 'workflow-name',
  description: '...',
  phases: [
    { title: 'Phase 1', detail: '...' },
    { title: 'Phase 2', detail: '...' },
  ],
}
```

### 8.2 内置工作流

| 工作流 | 说明 |
|--------|------|
| deep-research | 深度研究 |

---

## 9. Permission 系统

### 9.1 权限规则

```typescript
const defaults = Permission.fromConfig({
  "*": "allow",
  doom_loop: "ask",
  external_directory: {
    "*": "ask",
    "/path/to/project": "allow",
  },
  question: "deny",
  plan_enter: "deny",
})
```

### 9.2 权限操作

| 操作 | 说明 |
|------|------|
| allow | 允许 |
| deny | 拒绝 |
| ask | 询问确认 |

---

## 10. 关键设计决策

### 10.1 Doom Loop 检测

```typescript
const DOOM_LOOP_THRESHOLD = 3
```

连续 3 次重试后认为是 doom loop，阻止继续。

### 10.2 并发控制

| 配置 | 默认值 |
|------|--------|
| MAX_CONCURRENT | 16 |
| MAX_LIFECYCLE_AGENTS | 1000 |

### 10.3 Tool 调用权限保留

工具调用期间的权限由发起调用的 Agent 决定，不受后续 Agent 切换影响。

---

## 11. 参考价值

| 模块 | Pai 参考价值 |
|------|-------------|
| V2 Session | ⭐⭐⭐ 核心参考 |
| V2 Tools | ⭐⭐⭐ 工具系统 |
| Provider/Model | ⭐⭐ 重要参考 |
| Config | ⭐⭐ 重要参考 |
| Permission | ⭐⭐ 重要参考 |
| Workflow | ⭐ 有参考价值 |
