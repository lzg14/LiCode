# 审计层设计

**版本**: v1.0.0
**日期**: 2026-06-17
**参考**: opencode, DevEco Code

---

## 1. 审计日志

```yaml
audit:
  enabled: true
  log_dir: "~/.pai/logs"
  retention_days: 90
  levels:
    - INFO      # 正常操作
    - WARN      # 警告（危险操作）
    - BLOCKED   # 阻止的操作
    - SECURITY  # 安全事件
    - ERROR     # 错误
```

---

## 2. 日志格式

```json
{
  "timestamp": "2026-06-17T10:30:00.000Z",
  "level": "BLOCKED",
  "event": "command_blocked",
  "session": "sess_abc123",
  "user": "lzg14",
  "command": "rm -rf /",
  "reason": "dangerous command",
  "details": {}
}
```

---

## 3. 审计追踪的操作

| 类别 | 操作 | 记录内容 |
|------|------|----------|
| **命令执行** | 所有 shell 命令 | 命令、参数、退出码、输出摘要 |
| **文件操作** | Read/Write/Edit/Delete/Move | 文件路径、操作类型、大小 |
| **Git 操作** | commit/push/pull/merge | 仓库、操作、变更量 |
| **网络请求** | API 调用 | URL、方法、状态码 |
| **敏感操作** | 密码/密钥相关 | 操作类型、检测到的模式 |
| **安全事件** | 阻止/警告 | 事件类型、详情、用户响应 |

---

## 4. 告警机制

```yaml
audit:
  alerts:
    critical:
      - command_blocked          # 命令被阻止
      - path_violation          # 路径越界
      - sensitive_detected      # 敏感信息
    warning:
      - git_dangerous           # 危险 Git 操作
      - network_blocked         # 网络请求被阻止
  notification:
    console: true              # 控制台输出
    file: true                 # 写入日志
    webhook: false             # 可配置 webhook
```

---

## 5. 费用追踪（参考 DevEco Code）

| 统计项 | 说明 |
|--------|------|
| `tokens_used` | 估算的 token 消耗 |
| `cost_estimate` | 费用估算 |
| `commands_executed` | 本会话执行的命令数 |
| `files_modified` | 修改的文件数 |
| `security_events` | 安全事件数 |
| `operation_duration` | 操作耗时 |

---

## 6. 操作摘要

| 统计项 | 说明 |
|--------|------|
| `commands_executed` | 本会话执行的命令数 |
| `files_modified` | 修改的文件数 |
| `tokens_used` | 估算的 token 消耗 |
| `security_events` | 安全事件数 |
| `operation_duration` | 操作耗时 |

---

## 7. 日志存储

```
~/.pai/logs/
├── 2026-06-17.jsonl     # 当天日志
├── 2026-06-16.jsonl
├── ...
└── security-2026-06.jsonl  # 安全专项日志
```

---

## 8. 日志分析

| 分析维度 | 说明 |
|---------|------|
| **操作频率** | 哪些命令/工具最常用 |
| **错误模式** | 哪些操作容易失败 |
| **安全事件** | 被阻止的操作类型 |
| **Token 消耗** | 按用户/项目/会话统计 |
| **性能追踪** | 操作耗时分布 |
