# 工具系统设计

**版本**: v1.0.0
**日期**: 2026-06-17
**参考**: opencode V2 Tools

---

## 1. 工具分类

| 类别 | 工具数 | 示例 |
|------|--------|------|
| **代码编辑** | 8 | Read, Edit, Write, Delete, Move, Copy, Glob, Grep |
| **Git 操作** | 6 | GitStatus, GitCommit, GitPush, GitPull, GitBranch, GitMerge |
| **代码审查** | 4 | CodeReview, BugScan, SecurityScan, PerfAnalyze |
| **测试** | 4 | RunTests, GenTests, Coverage, Benchmark |
| **数据库** | 5 | Query, Execute, Migrate, Backup, Restore |
| **文件操作** | 6 | Mkdir, Rm, Cp, Mv, Zip, Unzip |
| **搜索** | 4 | WebSearch, CodeSearch, DocSearch, SemanticSearch |
| **Shell** | 3 | Bash, Run, Exec |

---

## 2. 工具类型系统（参考 opencode）

```typescript
type Definition<Input, Output>
type AnyTool = Definition<any, any>

interface ToolConfig<Input, Output> {
  description: string           // 工具描述（给模型看）
  input: Schema<Input>         // 输入 schema
  output: Schema<Output>       // 输出 schema
  execute: (input: Input, context: Tool.Context) => Effect<Output, ToolFailure>
  toModelOutput?: (input: Input, output: Output) => Tool.Content[]
}
```

**核心原则**：
- 工具是 opaque 类型，输入输出 codec 自包含
- Schema 转换不能依赖服务
- 工具依赖在构造时获取并捕获到 execute 中

---

## 3. 工具调用上下文（Tool.Context）

```typescript
interface Tool.Context {
  sessionID: string            // Session ID
  agentID: string              // 发起调用的 Agent ID
  assistantMessageID: string    // 包含调用的 assistant 消息 ID
  toolCallID: string            // 工具调用 ID
}
```

**原则**：
- 每个本地工具调用接收相同的具体上下文
- `assistantMessageID` 是包含该调用的消息的持久化 ID
- 解码后的输入单独传给 execute，原始输入和服务不属于上下文

---

## 4. 工具注册机制（参考 opencode）

```typescript
// 工具按名称注册
yield* tools.register({
  read,
  write,
  grep,
})

interface Tools {
  register(tools: Record<string, AnyTool>): Effect<void, Tool.RegistrationError>
}
```

**规则**：

| 规则 | 说明 |
|------|------|
| 名称唯一性 | 同名工具最新注册生效 |
| 注册覆盖 | 关闭注册只移除该注册 |
| 作用域优先级 | Location 注册 > 全局注册 |
| 注册捕获 | 注册记录的后续修改不影响已捕获的注册 |

---

## 5. 工具执行流程（参考 opencode）

```
Agent 决定调用工具
    │
    ├── 本地执行路径：
    │     │
    │     ├── 1. 解析工具名称，找到注册
    │     ├── 2. 用 input codec 解码输入
    │     ├── 3. 调用 execute(input, context)
    │     ├── 4. 用 output codec 编码输出
    │     ├── 5. 投影为 model-facing content
    │     ├── 6. 截断到限制大小
    │     └── 7. 返回 settlement + managed-output 引用
    │
    └── Provider-executed 路径：
          │
          └── LLM Provider 执行，结果直接返回
```

**无效处理**：
- 无效输入 → 不调用工具
- 无效输出 → 不返回成功 settlement

---

## 6. RWLock 机制

- 读工具并行执行（多个读取同时进行）
- 写工具独占锁（防止并发写冲突）
- 读等待写释放，写等待读完成

---

## 7. 输出截断策略（参考 opencode）

| 情况 | 处理方式 |
|------|----------|
| 内容存在 | 只测量文本部分，结构化 metadata 保持不变 |
| 内容为空 | 测量结构化输出 |
| 超过限制 | 保留在 managed storage，返回 bounded preview |

**Managed Output File**：
- 临时文件，过期后删除
- 保留完整输出在 Session 历史之外
- 路径不在工具 schema 中

---

## 8. 失败语义（参考 opencode）

| 类型 | 说明 | 处理 |
|------|------|------|
| `ToolFailure` | 预期的 model-visible 失败 | 返回给模型 |
| Interruption | 取消调用，不是工具结果 | 传播取消信号 |
| 意外错误/Defects | 操作失败 | 走 runner 的失败策略 |

**原则**：
- 叶子工具只翻译明确分类为可恢复的错误
- 不能 broad cause-catching，会消费 interruption

---

## 9. MCP 工具集成（参考 opencode）

```typescript
interface MCPConfig {
  command?: string              // MCP 服务器命令
  args?: string[]               // 参数
  env?: Record<string, string>  // 环境变量
  timeout?: number              // 超时
}

// MCP 工具发现
yield* mcp.discoverTools(serverConfig).pipe(
  Effect.map(tools => tools.register(tools))
```

**MCP 安全**：

| 配置 | 说明 |
|------|------|
| `auto_approve_local` | 本地 MCP 服务需确认 |
| `require_manifest` | 需要 manifest 声明能力 |
| `block_external` | 允许外部 MCP |

---

## 10. 工具法则（参考 opencode）

| 法则 | 说明 |
|------|------|
| **单一执行器** | `Tool.make(config)` 只能调用 `config.execute` |
| **Codec 边界** | 执行观察解码后的输入；投影观察编码后的输出 |
| **持久化身份** | 调用拥有的记录使用 runner 提供的精确 Session/agent/message/call ID |
| **作用域注册** | 关闭 Scope 移除该注册，暴露之前的注册 |
| **捕获执行** | 注册变更不能改变已进行的调用 |
| **Stale 拒绝** | 调用永远不执行除了 provider turn 中广告的注册之外的处理 |
| **存储封装** | 域输出不根据 model-output 截断或保留策略改变 |

---

## 11. 工厂函数模式（参考 Claude Code）

```typescript
function buildTool<I, O>(config: ToolConfig<I, O>): Tool<I, O> {
  return {
    id: config.id,
    name: config.name,
    description: config.description,
    inputSchema: config.inputSchema,
    outputSchema: config.outputSchema,
    execute: config.execute,
    retryPolicy: config.retryPolicy,
    timeout: config.timeout,
  }
}
```
