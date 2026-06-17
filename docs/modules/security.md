# 安全层设计

**版本**: v1.0.0
**日期**: 2026-06-17
**参考**: opencode, RTK-MCP

---

## 1. 设计背景

Claude Code 约 25% 代码处理权限和安全。AI Agent 本质是"有执行力的智能体"，必须解决：

| 能力 | 风险 | 需要什么 |
|------|------|---------|
| 执行命令 | 被误用执行危险操作 | 命令白名单 |
| 读写文件 | 泄露数据或破坏文件 | 文件系统边界 |
| Git 操作 | 危险操作（force push、rm） | 操作保护 + 确认 |
| 调用 API | 隐私泄露或恶意调用 | 网络访问限制 |

---

## 2. 命令白名单

**原则**：默认拒绝，仅允许明确列出的命令。

### 2.1 白名单分类（参考 RTK-MCP）

| 类别 | 允许的命令 |
|------|-----------|
| **Git** | git |
| **构建** | cargo, npm, npx, pnpm, pytest, go, make, dotnet |
| **代码检查** | ruff, mypy, eslint, prettier, biome, tsc |
| **数据库** | psql, mysql |
| **容器** | docker, playwright |
| **搜索** | grep, find |
| **文件** | ls, cat, head, tail, wc, echo, pwd, tree |
| **网络** | curl, wget, gh |
| **包管理** | pip, uv |
| **测试** | vitest, prisma |
| **开发** | node, next |

### 2.2 危险命令黑名单

- `bash`, `sh`, `zsh` — 任意 shell
- `rm`, `del` — 删除（必须用 Pai 的安全删除）
- `sudo`, `su` — 提权
- `chmod`, `chown` — 权限修改
- `python`, `python3` — 需通过 Pai 工具调用
- `exec`, `eval` — 代码执行

### 2.3 动态白名单

```yaml
security:
  command_whitelist:
    default:
      - git
      - cargo
      - npm
    project_additional: []  # 项目级额外允许
    session_temp: []        # 会话级临时允许（用完即删）
```

---

## 3. 文件系统边界

```yaml
security:
  filesystem:
    allowed_paths:
      - "{{project_root}}"      # 当前项目
      - "~/.pai"               # Pai 配置
      - "~/Documents"          # 文档目录
    denied_paths:
      - "~/.*"                 # 隐藏文件（配置目录除外）
      - "/etc"
      - "/sys"
      - "/proc"
    max_file_size: 10485760   # 10MB，单文件大小限制
    max_write_batch: 100       # 单次批量写入文件数限制
```

### 3.1 路径验证

- 相对路径自动拼接项目根目录
- 绝对路径必须命中 `allowed_paths`
- `..` 遍历自动拒绝
- 符号链接自动解析后验证

---

## 4. Git 操作保护

| 操作 | 风险等级 | 保护机制 |
|------|----------|----------|
| `git push --force` | 🔴 高 | 强制确认 + 默认拒绝 |
| `git push -d` | 🟡 中 | 确认提示 |
| `git reset --hard` | 🔴 高 | 强制确认 |
| `git rebase -i` | 🟡 中 | 警告 |
| `git checkout -f` | 🟡 中 | 警告 |
| `git clean -f` | 🔴 高 | 强制确认 |
| `rm` (文件删除) | 🔴 高 | 通过 Pai 工具，统一记录 |
| `git stash drop` | 🟡 中 | 确认提示 |

---

## 5. 网络访问限制

```yaml
security:
  network:
    allowed_domains:           # 白名单域名
      - "api.github.com"
      - "api.openai.com"
      - "*.anthropic.com"
    blocked_domains:          # 黑名单
      - "*.internal"
      - "localhost"
      - "127.0.0.1"
    max_request_size: 10485760  # 10MB
    timeout: 30000              # 30s 超时
    rate_limit:
      requests_per_minute: 60
      burst: 10
```

---

## 6. 敏感信息检测

```typescript
const SENSITIVE_PATTERNS = [
  /password\s*=/i,
  /api[_-]?key\s*=/i,
  /secret\s*=/i,
  /token\s*=/i,
  /private[_-]?key\s*=/i,
]

// 检测到后自动打码，仅显示前3后3字符
```

---

## 7. MCP 安全

**MCP 服务器验证**：

```yaml
security:
  mcp:
    auto_approve_local: false      # 本地 MCP 服务需确认
    require_manifest: true          # 需要 manifest 声明能力
    block_external: false           # 允许外部 MCP（需用户确认）
```

**工具调用审计**：
- 所有 MCP 工具调用记录到审计日志
- 异常调用模式自动告警

---

## 8. 安全事件处理

```typescript
interface SecurityEvent {
  type: 'command_blocked' | 'path_violation' | 'git_dangerous' | 'network_blocked' | 'sensitive_detected'
  timestamp: number
  details: Record<string, any>
  action: 'blocked' | 'warned' | 'allowed_with_log'
}
```
