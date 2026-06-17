# 集成层设计

**版本**: v1.0.0
**日期**: 2026-06-17
**参考**: opencode

---

## 1. 集成架构

```
Integration Layer (统一接口)
├── Git Integration
│   ├── GitHub / GitLab / Gitea
│   └── 文件系统
│
├── Database Integration
│   ├── MySQL / PostgreSQL / SQLite
│   └── Redis (缓存)
│
├── Notes Integration
│   ├── Obsidian (本地)
│   ├── Notion (云端 API)
│   └── 通用 Markdown
│
└── Cloud Integration
    ├── AWS SDK
    ├── 阿里云 SDK
    └── 腾讯云 SDK
```

---

## 2. 核心接口

```typescript
interface Integration {
  name: string
  enabled: boolean
  connect(): Promise<void>
  disconnect(): Promise<void>
  health(): Promise<HealthStatus>
}
```

---

## 3. Git 集成

| 功能 | 说明 |
|------|------|
| **仓库操作** | clone, pull, push, fetch |
| **分支管理** | branch, merge, rebase |
| **变更追踪** | diff, log, blame |
| **PR/MR** | 创建、审查、合并 |

### 3.1 Git 安全保护

| 操作 | 风险等级 | 保护机制 |
|------|----------|----------|
| `git push --force` | 🔴 高 | 强制确认 + 默认拒绝 |
| `git push -d` | 🟡 中 | 确认提示 |
| `git reset --hard` | 🔴 高 | 强制确认 |
| `git rebase -i` | 🟡 中 | 警告 |
| `git clean -f` | 🔴 高 | 强制确认 |

---

## 4. 数据库集成

| 功能 | 说明 |
|------|------|
| **Query** | SELECT 查询 |
| **Execute** | INSERT/UPDATE/DELETE |
| **Migrate** | 数据库迁移 |
| **Backup** | 备份 |
| **Restore** | 恢复 |

### 4.1 连接管理

```yaml
database:
  connections:
    - name: "main"
      type: "postgresql"
      host: "localhost"
      port: 5432
      database: "mydb"
      pool_size: 10
```

---

## 5. Notes 集成

| 平台 | 接口 |
|------|------|
| **Obsidian** | 本地文件系统 API |
| **Notion** | Notion API |
| **通用 Markdown** | 文件系统 |

---

## 6. MCP 集成（参考 opencode）

```typescript
interface MCPConfig {
  command?: string              // MCP 服务器命令
  args?: string[]               // 参数
  env?: Record<string, string>  // 环境变量
  timeout?: number              // 超时
}

interface MCP {
  discoverTools(config: MCPConfig): Effect<Tool[]>
  connect(config: MCPConfig): Effect<void>
  disconnect(): Effect<void>
}
```

### 6.1 MCP 安全

| 配置 | 说明 |
|------|------|
| `auto_approve_local` | 本地 MCP 服务需确认 |
| `require_manifest` | 需要 manifest 声明能力 |
| `block_external` | 允许外部 MCP |

---

## 7. Provider 集成

### 7.1 LLM Provider（参考 opencode）

| Provider | 说明 |
|----------|------|
| anthropic | Claude 系列 |
| openai | GPT 系列 |
| google | Gemini 系列 |
| local | Ollama 等 |

### 7.2 Model Catalog（参考 opencode）

```typescript
interface ModelCatalog {
  getModel(providerID: string, modelID: string): Effect<ModelInfo>
  listModels(): Effect<ModelInfo[]>
  listProviders(): Effect<ProviderInfo[]>
}

interface ModelInfo {
  id: string
  providerID: string
  name: string
  capabilities: {
    tools: boolean
    input: string[]
    output: string[]
  }
  cost: {
    input: number
    output: number
    cache: { read: number, write: number }
  }
  limit: {
    context: number
    output: number
  }
}
```

---

## 8. 插件系统（参考 opencode）

### 8.1 插件接口

```typescript
interface Plugin {
  name: string
  version: string
  boot(): Effect<void>
  shutdown(): Effect<void>
}
```

### 8.2 插件 Hooks

```typescript
type Hooks = {
  "provider.update": (input: ProviderDraft) => void
  "model.update": (input: ModelDraft) => void
  "account.activate": (input: AccountInfo) => void
}
```

### 8.3 插件生命周期

| 阶段 | 说明 |
|------|------|
| install | 安装插件 |
| enable | 启用插件 |
| boot | 启动时加载 |
| disable | 禁用插件 |
| uninstall | 卸载插件 |

---

## 9. RTK 集成（参考 RTK-MCP）

RTK 可作为 Pai 的外部工具集成：

| 命令 | Token 压缩率 |
|------|-------------|
| `cargo test` | 97.8% |
| `env` | 99.3% |
| `cargo clippy` | 92.5% |
| `git status` | ~78% |
| `grep` | 64.4% |

**集成方式**：Pai 执行命令时通过 `rtk <cmd>` 调用，fallback 到原生命令
