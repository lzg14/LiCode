# licode

**Personal AI OS** — 一个关于"想法"的实验

> 以前：有个想法 → 找人聊 → 没时间 → 算了  
> 现在：有个想法 → 跟 AI 聊清楚 → 2 小时出原型 → 跑起来了！

---

## 为什么有 licode？

不是要再做一个 AI 编程助手去和 Cursor、Claude Code、Copilot 竞争。

做 licode 的原因很简单：

**我想理解 AI Agent 到底是怎么工作的。**

看文章是一回事，真的动手搭一遍是另一回事。只有亲手写过：

- 一个完整的七阶段流水线（OBSERVE → THINK → PLAN → BUILD → EXECUTE → VERIFY → LEARN）
- 一套 Session 管理和 Checkpoint 恢复
- 一个记忆系统和上下文继承
- 一套安全边界和权限控制
- 一个终端 UI（SolidJS + @opentui）

你才能真正理解一个 AI Agent 系统需要考虑多少事情。

**这就是 licode 的定位** — 一个学习 AI Agent 架构的 playground。

---

## 核心特性

| 特性 | 说明 |
|------|------|
| **七阶段 Core Loop** | OBSERVE → THINK → PLAN → BUILD → EXECUTE → VERIFY → LEARN |
| **Effort Level 自动路由** | E1 快速路径 / E2-E3 标准 / E4-E5 完整流程 |
| **Session 管理** | SQLite 持久化，跨启动自动恢复最近会话 |
| **Checkpoint 恢复** | 断点续传，不丢失进度 |
| **上下文继承** | 子会话可继承父会话上下文 |
| **Review Agent** | E3+ 自动触发反方视角评审 |
| **工具系统** | 文件操作、Git、Shell 等内置工具 |
| **安全层** | 命令白名单、路径限制、权限控制 |
| **多 LLM 支持** | Anthropic / OpenAI 切换 |

---

## 快速开始

```bash
# 克隆
git clone https://github.com/your-username/licode.git
cd licode

# 安装依赖
bun install

# 配置 API Key
export ANTHROPIC_API_KEY="your-api-key"

# 启动
bun run dev
```

配置参考 `licode.config.json.example`。

---

## 项目结构

```
licode/
├── packages/
│   ├── core/           # ✅ 核心循环（loop、phases、checkpoint、compaction）
│   ├── tools/          # ✅ 27 个工具（文件/搜索/Git/Web/Excel/数据库）
│   ├── session/        # ✅ 会话管理（SQLite 持久化、历史压缩）
│   ├── tui/            # ✅ 终端 UI（SolidJS + @opentui）
│   ├── config/         # ✅ 配置管理（多层级/环境变量/外部导入）
│   ├── llm/            # ✅ LLM Provider（Anthropic/OpenAI/DeepSeek）
│   ├── security/       # ✅ 安全层（命令白名单已接线到 bash 工具）
│   ├── skills/         # ✅ 技能系统（已接线到 skill 工具）
│   ├── memory/         # ✅ 记忆系统（FTS5、recall）
│   ├── audit/          # ⏸️ 审计日志（已调用但日志文件无人查看）
│   ├── integration/    # ⏸️ 外部集成（Git 已用，MCP/Obsidian/DB 待接线）
│   ├── agent/          # ⏸️ Agent 系统（骨架完成，未集成到 Core Loop）
│   ├── snapshot/       # ⏸️ 文件快照（预留，供 Diff 预览使用）
│   ├── question/       # ⏸️ 提问引擎（预留，供 Interview 阶段使用）
│   ├── server/         # ⏸️ HTTP API（预留，独立服务）
│   ├── plugin/         # ⏸️ 插件系统（预留，插件市场待填充）
│   └── worktree/       # ⏸️ 工作树管理（预留）
├── docs/               # 设计文档
│   ├── core-loop/      # 七阶段、Effort Level、Interview 设计
│   └── modules/        # 各模块设计文档
└── package.json
```

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 运行时 | [Bun](https://bun.sh/) |
| 语言 | TypeScript |
| TUI | [SolidJS](https://www.solidjs.com/) + [@opentui](https://github.com/nicholasgasior/opentui) |
| LLM | [Anthropic](https://www.anthropic.com/) / [OpenAI](https://openai.com/) |
| 验证 | [Zod](https://zod.dev/) |
| 数据库 | SQLite (bun:sqlite) |
| 测试 | [Vitest](https://vitest.dev/) |

---

## 设计文档

| 文档 | 内容 |
|------|------|
| [Core Loop 概述](./docs/core-loop/README.md) | 核心理念、模块索引 |
| [七阶段循环](./docs/core-loop/20260617-seven-phase.md) | OBSERVE → THINK → PLAN → BUILD → EXECUTE → VERIFY → LEARN |
| [Effort Level 路由](./docs/core-loop/20260617-effort-level.md) | E1-E5 分级、Fast-path、门禁条件 |
| [Interview 机制](./docs/core-loop/20260617-interview.md) | grill-me 追问、Anti-criteria 反向评估 |
| [上下文管理](./docs/core-loop/20260617-context.md) | Compaction、Memory Recall |
| [多 Agent 协调](./docs/core-loop/20260617-multi-agent.md) | Spawn、并发控制、权限继承 |
| [异常处理](./docs/core-loop/20260617-exception.md) | 重试、降级、Doom Loop 检测 |

---

## License

MIT
