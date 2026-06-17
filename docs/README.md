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

## 模块依赖关系

```
┌─────────────────────────────────────────────────────────────┐
│                    Core Loop（主调度）                        │
│   负责协调所有模块，决定调用顺序                            │
└─────────────────┬───────────────────────────────────────┘
                  │
    ┌─────────────┼─────────────┬─────────────┬─────────────┐
    │             │             │            │             │
    ▼             ▼             ▼            ▼             ▼
┌────────┐  ┌────────┐  ┌─────────┐  ┌────────┐  ┌────────┐
│ Tools  │  │ Memory │  │ Skills  │  │ Config │  │ Audit  │
│        │  │        │  │         │  │        │  │        │
│ 执行   │◄─┤ 存储   │  │ 调用Tools│  │ 加载   │  │ 记录   │
│ 原子  │  │ 长期   │  │ 复杂   │  │ 验证   │  │ 所有   │
│ 操作  │  │ 记忆   │  │ 任务流 │  │ 配置   │  │ 模块   │
└───┬────┘  └────┬────┘  └────┬────┘  └────────┘  └────┬────┘
    │             │             │                       │
    │             │             │                       │
    ▼             ▼             ▼                       │
┌────────┐  ┌────────┐  ┌────────┐                       │
│Security│  │ Session│  │Integration                         │
│        │  │        │  │                                  │
│权限检查│  │短期记忆│  │外部集成                          │
│命令   │◄─┤Checkpoint                        │
│白名单 │  │ 中期   │  │ (Git/DB/Notes/MCP/RTK)           │
└────────┘  └────────┘  └──────────────────────────────────┘
```

**依赖说明**：

| 模块 | 被依赖 | 依赖 |
|------|--------|------|
| **Core Loop** | 所有模块 | 所有模块 |
| **Tools** | Skills, Integration | Security |
| **Memory** | Skills | Session |
| **Session** | Memory | - |
| **Security** | - | Config |
| **Config** | - | - |
| **Audit** | - | 所有模块 |
| **Skills** | - | Tools, Memory |
| **Integration** | - | Tools, Security |

---

## Memory/Session/Checkpoint 边界

| 类型 | 生命周期 | 存储 | 用途 |
|------|----------|------|------|
| **Session History** | 短期，随 session | 内存 + SQLite | 当前对话上下文 |
| **Checkpoint** | 中期，session 间 | SQLite | 断点恢复 |
| **Memory** | 长期，跨 session | SQLite + Markdown | 持久化知识 |

---

## 版本历史

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.8.0 | 2026-06-17 | 处理审阅反馈，添加模块依赖图 |
| v1.0.0 | 2026-06-17 | 初始版本 |

---

## 版本历史

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0.0 | 2026-06-17 | 初始版本，文档结构完整 |
