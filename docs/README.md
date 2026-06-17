# Pai 设计文档

**Pai** - Personal AI OS

## 文档结构

```
docs/
├── README.md                    # 本索引页
├── core-loop/                   # Core Loop 核心设计
│   ├── README.md             # Core Loop 概述
│   ├── 20260617-effort-level.md
│   ├── 20260617-seven-phase.md
│   ├── 20260617-interview.md
│   ├── 20260617-context.md
│   ├── 20260617-multi-agent.md
│   └── 20260617-exception.md
├── modules/                    # 各模块设计
│   ├── tools.md             # 工具系统
│   ├── memory.md            # 记忆系统
│   ├── skills.md            # Skills 系统
│   ├── integration.md       # 集成层
│   ├── security.md          # 安全层
│   ├── audit.md             # 审计层
│   └── config.md            # 配置层
└── reference/                # 参考文档
    └── opencode-analysis.md # opencode 架构分析
```

---

## Core Loop 核心特性

Pai 的 Core Loop 与其他 Agent 的核心差异：

| 特性 | 说明 |
|------|------|
| **E1-E5 Effort Level** | 自动判断任务复杂度，无需用户手动切换模式 |
| **grill-me Interview** | 内置追问机制，一次只问一个问题 |
| **Anti-criteria** | 反向追问，展示弊端，确保用户充分了解 |
| **Safe Boundary** | Provider 调用前的安全边界 |
| **Tool 权限保留** | 发起 Agent 的权限不变 |

---

## 模块设计

| 模块 | 说明 | 参考 |
|------|------|------|
| **Tools** | 工具系统、类型、注册、执行 | opencode V2 |
| **Memory** | 三层记忆、Recall、索引 | mimo-code |
| **Skills** | Skill 自改进、热加载、版本管理 | hermes-agent |
| **Integration** | Git/DB/Notes/MCP/RTK | opencode |
| **Security** | 命令白名单、文件系统、网络限制 | RTK-MCP |
| **Audit** | 审计日志、费用追踪、安全事件 | DevEco Code |
| **Config** | 多层配置、Provider 切换 | opencode V2 |

---

## 版本历史

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0.0 | 2026-06-17 | 初始版本，文档结构完整 |
