# 多 Agent 协调与 Task 生命周期

**版本**: v1.7.0
**日期**: 2026-06-17

---

## 1. 多 Agent 协调机制

### 1.1 设计背景

opencode 的架构证明：复杂任务需要多个 Agent 协同工作。单个 Agent 受限于单一上下文，多 Agent 可以并行处理不同子任务。

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

### 1.7 Structured Output

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
