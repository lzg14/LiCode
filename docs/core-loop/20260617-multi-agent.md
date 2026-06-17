# 多 Agent 协调与 Task 生命周期

**版本**: v2.0.0
**日期**: 2026-06-17
**参考**: hermes-agent, DeerFlow, awesome-ai-anatomy/subagent-delegation

---

## 1. 多 Agent 协调机制

### 1.1 设计背景

**参考 hermes-agent 和 DeerFlow 的子 Agent 设计。**

| 框架 | MAX_CONCURRENT | MAX_DEPTH | 隔离策略 | Blocked Tools |
|------|---------------|-----------|----------|---------------|
| **hermes-agent** | 3 | 1 | 完全隔离 | delegate_task, clarify, memory, send_message, execute_code |
| **DeerFlow** | 3 | 1 | 共享父线程状态 | 无 self-delegation |
| **OpenClaw** | 可配置 | 可配置 | 可配置隔离 | 无 |
| **licode** | 3 | 1 | 可配置隔离 | 见 1.9 节 |

**核心原则**：
1. 子 Agent **不能递归派生**（MAX_DEPTH = 1）
2. 子 Agent **完全隔离**，不共享内存
3. 限制并发数量，防止资源耗尽

### 1.2 Agent 类型定义

| Agent 类型 | 说明 | 权限 |
|------------|------|------|
| **primary** | 主 Agent，直接与用户交互 | 完整权限 |
| **subagent** | 子 Agent，由 primary 派生 | 受限权限 |
| **fork** | 检查点写入 Agent，复制父上下文 | 受限权限 |

### 1.3 内置 Agent 类型

| Agent | 类型 | 用途 |
|--------|------|------|
| **build** | primary | 主执行 Agent |
| **plan** | primary | 只读计划模式 |
| **explore** | subagent | 代码探索 |
| **compaction** | subagent | 上下文压缩 |
| **checkpoint-writer** | fork | 检查点写入 |
| **dream** | subagent | 创意生成 |
| **distill** | subagent | 内容提炼 |

### 1.4 Spawn 参数

```typescript
interface SpawnInput {
  mode: 'primary' | 'subagent'
  agentType: string
  task: string
  description?: string
  context: 'full' | 'minimal' | 'fork'
  tools: string[] | 'inherit'
  model?: { provider: string; model: string }
  background: boolean
  task_id?: string
  cwd?: string
  timeoutMs?: number
  format?: OutputFormat  // Structured Output
}
```

### 1.5 并发控制

| 配置 | 默认值 | 说明 |
|------|--------|------|
| `maxConcurrentAgents` | 16 | 单次运行最大并发 Agent 数 |
| `maxLifecycleAgents` | 1000 | 整个生命周期最大 Agent 数（硬上限） |
| `agentTimeoutMs` | undefined | 单个 Agent 超时（默认无限） |
| `maxPreReact` | 3 | 单次 Spawn 最大 ReAct 重入次数 |
| `maxPostReact` | 3 | Stop 后最大 ReAct 重入次数 |

### 1.6 Fork Context（上下文复制）

当 spawn fork 类型 Agent 时，复制父 Agent 的完整上下文：

```typescript
interface ForkContext {
  system: string[]           // 系统提示
  tools: Tool[]              // 工具 schema
  parentPermission: Permission.Ruleset  // 父权限
  inheritedMessages: ModelMessage[]     // 消息历史
  watermarkMsgID: string      // 水印标记
  model: { providerID, modelID }
}
```

**用途**：检查点写入 Agent 需要看到与父 Agent 相同的上下文。

### 1.7 权限继承规则

**核心原则**：
- 子 Agent 权限**不能超过**父 Agent 权限
- 子 Agent 可以请求更低权限（降级）
- 权限不足时**默认拒绝**，不是降级

**权限请求流程**：
```
子 Agent 请求更高权限
    │
    ├── 检查 parentPermission
    │
    ├── 如果请求 <= parentPermission → 允许
    │
    └── 如果请求 > parentPermission
              │
              ├── 用户确认 → 临时提升
              │
              └── 用户拒绝 → 拒绝请求
```

**权限级别**：
| 级别 | 说明 |
|------|------|
| L1 | 只读（grep, read, glob） |
| L2 | L1 + 文件操作（write, edit） |
| L3 | L2 + 危险操作（delete, exec） |
| L4 | L3 + 系统操作（sudo, chmod） |
| L5 | 完整权限 |

### 1.8 Subagent Blocked Tools（hermes-agent 模式）

**子 Agent 禁止使用的工具**（防止递归和危险操作）：

```typescript
const SUBAGENT_BLOCKED_TOOLS = frozenset([
  "delegate_task",   // 禁止递归派生子 Agent
  "clarify",        // 禁止用户交互
  "memory_write",   // 禁止写入共享内存
  "send_message",   // 禁止跨平台副作用
  "execute_code",   // 禁止执行脚本（应 step-by-step 推理）
])
```

**设计理由**：

| 工具 | 禁止原因 |
|------|----------|
| `delegate_task` | 防止无限递归，MAX_DEPTH = 1 |
| `clarify` | 子 Agent 不能向用户提问 |
| `memory_write` | 防止并发写入导致数据竞争 |
| `send_message` | 防止跨会话副作用 |
| `execute_code` | 子 Agent 应推理而非写脚本执行 |

### 1.9 Subagent 并发控制

```typescript
interface SubagentLimits {
  maxConcurrent: 3       // 最大并发数（hermes-agent/DeerFlow 一致）
  maxDepth: 1             // 最大深度（禁止递归）
  timeoutMs: 900000       // 15 分钟超时
}
```

**执行模型**（DeerFlow 双线程池模式）：

```
┌─────────────────────────────────────────────────────────────┐
│                    Subagent 执行池                          │
│                                                             │
│  _scheduler_pool (max_workers=3) ──► 调度任务               │
│                                                             │
│  _execution_pool (max_workers=3) ──► 执行任务               │
│                         │                                   │
│                         ▼                                   │
│               ┌─────────────────┐                          │
│               │  子 Agent 执行   │                          │
│               │  (隔离上下文)    │                          │
│               └─────────────────┘                          │
└─────────────────────────────────────────────────────────────┘
```

### 1.10 隔离策略

| 隔离级别 | 说明 | 使用场景 |
|----------|------|----------|
| **isolated** | 完全隔离，无共享内存 | 默认模式，安全性最高 |
| **shared_state** | 共享父线程状态 | DeerFlow 模式，有数据竞争风险 |
| **optional_stream** | 隔离但可选流式传输 | OpenClaw 模式 |

**licode 默认使用 `isolated` 模式**（参考 hermes-agent）。

### 1.11 Structured Output

支持 schema-based 结构化输出：

```typescript
interface StructuredOutputRequest {
  format: {
    type: 'json_schema'
    name: string
    schema: object
  }
}

// Agent 返回格式
interface AgentOutcome {
  status: 'success' | 'partial' | 'failed' | 'blocked'
  finalText?: string
  structured?: unknown  // 验证后的结构化对象
  incompleteTasks?: string[]
}
```

---

## 2. Task 生命周期管理

### 2.1 Task 状态机

```
         create
    ┌──────────────┐
    │   pending    │
    └──────┬───────┘
           │ start
           ▼
    ┌──────────────┐
    │   running    │◄─────┐
    └──────┬───────┘      │
           │              │
     ┌─────┴─────┐        │
     │           │        │
     ▼           ▼        │ continue
  block      unblock      │
    │           │        │
    └─────┬─────┘        │
          │              │
          ▼              │
    ┌──────────────┐     │
    │   waiting    │─────┘
    └──────┬───────┘
           │
           ▼
    ┌──────────────┐
    │    done      │ (terminal)
    └──────────────┘

    abandon ──► abandoned (terminal)
```

### 2.2 Task 操作

| 操作 | 说明 |
|------|------|
| `create` | 创建 Task |
| `start` | 开始执行 |
| `block` | 阻塞等待 |
| `unblock` | 解锁继续 |
| `done` | 标记完成 |
| `abandon` | 放弃任务 |
| `rename` | 重命名 |

### 2.3 Task 层级

- Task ID 格式：`T1.T1.1`（树形层级）
- 支持 parent_task_id 关联
- 支持 task_id 绑定用户任务

### 2.4 Task 事件

每个 Task 维护事件日志：

```typescript
interface TaskEvent {
  id: string
  task_id: string
  at: number
  kind: 'created' | 'started' | 'blocked' | 'unblocked' | 'done' | 'abandoned'
  summary?: string
}
```

**存储策略**：
| 存储位置 | 说明 |
|----------|------|
| **内存** | 当前 session 活跃的 Task 事件 |
| **SQLite** | 持久化到 `~/.pai/data/tasks.db` |
| **Session 绑定** | 事件与 session 关联，可跨 session 查询 |

**存储设计**：
```
~/.pai/data/
└── tasks.db
    ├── task_events     # Task 事件表
    ├── tasks          # Task 状态表
    └── task_summaries # Task 摘要表（用于跨 session 恢复）
```

**清理策略**：
- `archive_days: 7` — 超过 7 天的非活跃 Task 归档
- `cleanup_days: 30` — 超过 30 天的历史数据清理

### 2.5 清理策略

```yaml
task:
  archive_days: 7      # 归档前保留天数
  cleanup_days: 7      # 清理前保留天数
```

---

## 3. Session 嵌套机制

### 3.1 Session 类型

| 类型 | 说明 |
|------|------|
| **parent session** | 顶层会话，直接与用户交互 |
| **child session** | 子会话，由 spawn 创建 |

### 3.2 Session 层级

```
用户 Session (parent)
    │
    ├── Agent A (subagent) → Session A (child)
    │       │
    │       └── Task → Session B (grandchild)
    │
    └── Agent B (subagent) → Session C (child)
```

### 3.3 Session 隔离

- child session 写入 parent 的 checkpoint/memory
- parent session 可查看所有 child session 状态
- child session 共享 parent 的 memory 路径权限

### 3.4 Checkpoint 机制

```typescript
interface Checkpoint {
  session_id: string
  parent_id?: string
  state: SessionRunState
  messages: ModelMessage[]
  created_at: number
}
```

---

## 4. 多 Agent 设计决策总结

### 4.1 设计来源

| 特性 | 来自 | 理由 |
|------|------|------|
| MAX_CONCURRENT = 3 | hermes-agent + DeerFlow | 防止资源耗尽 |
| MAX_DEPTH = 1 | hermes-agent + DeerFlow | 禁止递归派生 |
| Blocked Tools | hermes-agent | 防止危险操作 |
| 双线程池 | DeerFlow | 调度与执行分离 |
| 完全隔离 | hermes-agent | 安全性优先 |

### 4.2 三种隔离策略对比

| 策略 | 优点 | 缺点 | 适用场景 |
|------|------|------|----------|
| **DeerFlow (共享状态)** | 子 Agent 可共享发现 | 有数据竞争风险 | 信任 LLM |
| **Hermes (完全隔离)** | 安全，无竞争 | 子 Agent 不能共享发现 | 高安全场景 |
| **OpenClaw (可配置)** | 灵活 | 需要配置 | 高级用户 |

**licode 默认使用 Hermes 模式（完全隔离）**。

### 4.3 子 Agent 不能做的事

| 限制 | 原因 |
|------|------|
| 不能派生子 Agent | MAX_DEPTH = 1 |
| 不能向用户提问 | clarify 被阻止 |
| 不能写共享内存 | memory_write 被阻止 |
| 不能执行代码 | execute_code 被阻止 |
| 不能发消息 | send_message 被阻止 |

### 4.4 推荐配置

```yaml
subagent:
  max_concurrent: 3
  max_depth: 1
  timeout_ms: 900000  # 15 分钟
  isolation: "isolated"  # 完全隔离

  blocked_tools:
    - delegate_task
    - clarify
    - memory_write
    - send_message
    - execute_code
```
