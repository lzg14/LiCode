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
│   ├── tools.md
│   ├── memory.md
│   ├── skills.md
│   ├── integration.md
│   ├── security.md
│   ├── audit.md
│   └── config.md
└── reference/                  # 参考文档
    └── opencode-analysis.md
```

## Core Loop 核心特性

Pai 的 Core Loop 与其他 Agent 的核心差异：

| 特性 | 说明 |
|------|------|
| **E1-E5 Effort Level** | 自动判断任务复杂度，无需用户手动切换模式 |
| **grill-me Interview** | 内置追问机制，一次只问一个问题 |
| **Anti-criteria** | 反向追问，展示弊端，确保用户充分了解 |
| **Safe Boundary** | Provider 调用前的安全边界 |
| **Tool 权限保留** | 发起 Agent 的权限不变 |

## 版本历史

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.7.0 | 2026-06-17 | 新增 Safe Boundary 和 Tool 权限保留 |
| v1.6.0 | 2026-06-17 | 新增反向追问机制 |
| v1.5.0 | 2026-06-17 | Interview 内置为 Agent 默认行为 |
| v1.4.0 | 2026-06-17 | 强化需求理解机制 |
