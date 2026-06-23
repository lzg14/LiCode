# licode 设计文档

**licode** - Personal AI OS

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
└── modules/                    # 各模块设计
    ├── tools.md             # 工具系统
    ├── memory.md            # 记忆系统
    ├── skills.md            # Skills 系统
    ├── integration.md       # 集成层
    ├── security.md          # 安全层
    ├── audit.md             # 审计层
    ├── config.md            # 配置层
    └── tui.md               # TUI 模块
```

---

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| **运行时** | Bun | 快速启动、原生 TypeScript |
| **TUI** | SolidJS + @opentui | 响应式 UI、终端渲染 |
| **LLM** | Anthropic / OpenAI | 流式输出、多模型支持 |
| **核心** | TypeScript | 类型安全、模块化 |
