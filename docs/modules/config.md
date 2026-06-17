# 配置层设计

**版本**: v1.0.0
**日期**: 2026-06-17
**参考**: opencode V2 config

---

## 1. 配置层级

```
~/.pai/config.yaml           # 全局配置
  ↓
~/project/.pai/config.yaml    # 项目配置（覆盖全局）
  ↓
--cli-args                   # 命令行参数（最高优先级）
```

---

## 2. 配置结构

```yaml
# ~/.pai/config.yaml 示例
pai:
  version: "1.0.0"
  
llm:
  provider: "anthropic"       # anthropic | openai | local
  model: "claude-sonnet-4-20250514"
  api_key_env: "ANTHROPIC_API_KEY"   # 从环境变量读取

security:
  command_whitelist:
    default:
      - git
      - cargo
      - npm
  filesystem:
    allowed_paths:
      - "~"
    denied_paths:
      - "/etc"
      - "/sys"
      
memory:
  path: "~/.pai/memory"
  retention_days: 365
  
rtk:
  enabled: true
  path: "/usr/local/bin/rtk"  # RTK 安装路径
  fallback: true              # RTK 不可用时 fallback
  
tools:
  timeout: 30000
  retry: 3
  max_concurrent: 5
```

---

## 3. 环境变量隔离

**敏感配置不进 prompt**：

```yaml
# 正确做法
llm:
  api_key_env: "ANTHROPIC_API_KEY"   # Pai 从环境变量读取

# 错误做法（禁止）
llm:
  api_key: "sk-ant-xxxx"            # 禁止硬编码
```

---

## 4. 项目级配置

```yaml
# ~/project/.pai/config.yaml
pai:
  project_root: "/path/to/project"
  
security:
  command_whitelist:
    project_additional:
      - my_custom_script      # 项目特定命令
      
tools:
  timeout: 60000              # 项目级超时覆盖
  
rtk:
  enabled: false              # 项目级禁用 RTK
```

---

## 5. Provider 切换（参考 DevEco Code）

支持多 LLM 提供者动态切换：

| Provider | 说明 |
|----------|------|
| anthropic | Claude 系列 |
| openai | GPT 系列 |
| local | 本地模型（Ollama 等） |

### 5.1 多 Model 用例配置

Claude Code 支持在不同场景用不同 Model，Pai 同样支持：

```yaml
models:
  # 默认 model（简单任务）
  default:
    provider: "anthropic"
    model: "claude-haiku-4-20250514"

  # 复杂任务用更强的 model
  complex:
    provider: "anthropic"
    model: "claude-opus-4-20250514"

  # 评审用独立 model
  review:
    provider: "anthropic"
    model: "claude-sonnet-4-20250514"

  # 本地快速 model
  fast:
    provider: "local"
    model: "qwen2.5-72b"

  # 代码生成用专用 model
  code:
    provider: "anthropic"
    model: "claude-sonnet-4-20250514"
```

### 5.2 场景路由规则

```yaml
model_routing:
  # 简单命令/查询 → 用 fast model
  - pattern: "E1|E2"
    model: "fast"

  # E4/E5/评审 → 用 strong model
  - pattern: "E4|E5|review"
    model: "complex"

  # 代码生成 → 用 code model
  - pattern: "write|edit|refactor"
    model: "code"

  # 默认 → default model
  - pattern: "*"
    model: "default"
```

### 5.3 模型成本优先级

| 优先级 | 使用场景 |
|----------|----------|
| 1. 成本优先 | 简单任务、快速查询 |
| 2. 质量优先 | 复杂任务、评审 |
| 3. 速度优先 | 实时交互、lint/check |
| 4. 平衡 | 默认场景 |

---

## 6. 配置 Schema（参考 opencode）

```typescript
// Provider Schema
export const ProviderConfig = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  enabled: Schema.Union([
    Schema.Literal(false),
    Schema.Struct({
      via: Schema.Literal("env"),
      name: Schema.String,
    }),
    Schema.Struct({
      via: Schema.Literal("account"),
      service: Schema.String,
    }),
    Schema.Struct({
      via: Schema.Literal("custom"),
      data: Schema.Record(Schema.String, Schema.Any),
    }),
  ]),
  env: Schema.String.pipe(Schema.Array),
  endpoint: Schema.Union([...]),
  options: Schema.Struct({
    headers: Schema.Record(Schema.String, Schema.String),
    body: Schema.Record(Schema.String, Schema.Any),
  }),
})

// Model Schema
export const ModelConfig = Schema.Struct({
  id: Schema.String,
  providerID: Schema.String,
  name: Schema.String,
  capabilities: Schema.Struct({
    tools: Schema.Boolean,
    input: Schema.String.pipe(Schema.Array),
    output: Schema.String.pipe(Schema.Array),
  }),
  cost: Schema.Struct({
    input: Schema.Finite,
    output: Schema.Finite,
    cache: Schema.Struct({
      read: Schema.Finite,
      write: Schema.Finite,
    }),
  }),
  limit: Schema.Struct({
    context: Schema.Int,
    output: Schema.Int,
  }),
})
```

---

## 7. 配置验证

| 规则 | 说明 |
|------|------|
| 类型验证 | 使用 Zod/Effect Schema 验证 |
| 必需字段 | 明确标记可选 vs 必需 |
| 默认值 | 缺失字段使用默认值 |
| 覆盖规则 | 项目配置 > 全局配置 > 默认值 |

### 7.1 验证失败处理

```typescript
// 验证失败时
interface ConfigValidationError {
  path: string        // 配置路径
  expected: string     // 期望类型
  actual: any         // 实际值
  reason: string      // 失败原因
}

// 错误处理策略
const onValidationError = (err: ConfigValidationError) => {
  if (err.path.startsWith("security")) {
    // 安全配置失败 → 使用安全默认值 + 警告
    return safeDefaults[err.path]
  }
  if (err.path.startsWith("llm")) {
    // LLM 配置失败 → 终止启动
    throw new Error(`Config invalid: ${err.path}`)
  }
}
```

### 7.2 环境变量替换

```yaml
# config.yaml
llm:
  api_key: "${ANTHROPIC_API_KEY}"   # 环境变量替换
  model: "${DEFAULT_MODEL:-claude-sonnet}"  # 支持默认值
```

```typescript
// 替换规则: ${VAR:-default} → process.env[VAR] || "default"
```

### 7.3 热更新机制

配置文件修改后自动重新加载：

| 配置类型 | 热更新 | 说明 |
|----------|--------|------|
| `audit.*` | ✅ 立即 | 审计配置可以随时改 |
| `tools.timeout` | ✅ 立即 | 工具超时可以随时改 |
| `security.*` | ⚠️ 确认 | 安全配置需用户确认 |
| `llm.provider` | ❌ 重启 | Provider 切换需重启 |
| `memory.path` | ❌ 重启 | 存储路径变更需重启 |

---

## 8. RTK Fallback 机制

### 8.1 Fallback 策略

RTK 不可用时的处理：

| 情况 | 处理方式 |
|------|----------|
| RTK 未安装 | 直接执行原生命令 |
| RTK 超时 | fallback 到原生命令 |
| RTK 报错 | fallback 到原生命令 |

### 8.2 RTK vs Raw 输出差异

| 差异 | RTK | Raw |
|------|-----|-----|
| Token 压缩 | 60-97% | 0% |
| 保留信息 | 关键结果 | 全部 |
| 使用场景 | LLM 调用 | 用户查看 |
