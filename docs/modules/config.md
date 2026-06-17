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
