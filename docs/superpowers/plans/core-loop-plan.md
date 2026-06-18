# licode Core Loop 开发计划

**日期**: 2026-06-18
**目标**: 基于 mimo-code 架构，实现 licode 核心 Core Loop

---

## 1. 架构决策

### 1.1 技术选型

| 决策 | 选择 | 理由 |
|------|------|------|
| 运行时 | Bun | 与 mimo-code 一致，性能好 |
| 语言 | TypeScript | 与 mimo-code 一致 |
| 函数式框架 | Effect-TS | 与 mimo-code 一致，可复用服务层模式 |
| LLM SDK | Vercel AI SDK | 与 mimo-code 一致 |
| 数据库 | SQLite + Drizzle | 轻量，与 mimo-code 一致 |
| 包管理 | pnpm | monorepo 友好 |

### 1.2 复用策略

从 mimo-code 复用（参考实现，不直接引用）：
- Core Loop 主循环结构 (`runLoop`)
- Tool 系统接口和注册机制
- Actor/Session 管理模式
- Permission 权限模型

licode 独有实现：
- E1-E5 Effort Level 路由器
- grill-me Interview 机制
- Anti-criteria 反向追问
- 七阶段循环（OBSERVE → THINK → PLAN → BUILD → EXECUTE → VERIFY → LEARN）
- Review Agent 自动评审

---

## 2. 模块拆分

### Phase 1: 最小可用 Core Loop (Week 1)

**目标**: 能跑通一次完整的 用户输入 → LLM 调用 → 工具执行 → 返回结果

| 模块 | 文件 | 职责 |
|------|------|------|
| CLI 入口 | `packages/core/src/cli/index.ts` | 命令行启动 |
| Core Loop | `packages/core/src/loop/run.ts` | 主循环（OBSERVE → BUILD → EXECUTE） |
| Session | `packages/core/src/session/session.ts` | 会话管理、消息存储 |
| LLM | `packages/core/src/llm/client.ts` | LLM 调用封装 |
| Tool Registry | `packages/core/src/tool/registry.ts` | 工具注册和调度 |
| Tool: bash | `packages/core/src/tool/bash.ts` | Shell 命令执行 |
| Tool: read | `packages/core/src/tool/read.ts` | 文件读取 |
| Tool: write | `packages/core/src/tool/write.ts` | 文件写入 |
| Tool: edit | `packages/core/src/tool/edit.ts` | 文件编辑 |
| Config | `packages/core/src/config/config.ts` | 配置加载 |

**验证标准**: `licode run "ls -la"` 能执行并返回结果

### Phase 2: Effort Level 路由 (Week 2)

**目标**: 自动判断任务复杂度，决定执行策略

| 模块 | 文件 | 职责 |
|------|------|------|
| Effort Router | `packages/core/src/loop/effort.ts` | E1-E5 分级判断 |
| Phase Controller | `packages/core/src/loop/phase.ts` | 七阶段状态机 |
| Think Phase | `packages/core/src/loop/think.ts` | 思考阶段：风险分析、假设检查 |
| Plan Phase | `packages/core/src/loop/plan.ts` | 规划阶段：scope 策略 |

**Effort Level 定义**:

| Level | 名称 | 触发条件 | 行为 |
|-------|------|----------|------|
| E1 | Quick Fix | 单文件、明确、低风险 | 直接执行 |
| E2 | Standard | 影响范围清晰、中等复杂度 | 执行 + 验证 |
| E3 | Complex | 多文件、有风险 | OBSERVE → PLAN → BUILD → VERIFY |
| E4 | Critical | 架构变更、高风险 | 完整七阶段 + Interview |
| E5 | Exploratory | 需求模糊、需要调研 | 强制 Interview + 多轮澄清 |

**验证标准**: 输入不同复杂度的任务，能自动选择正确的 Effort Level

### Phase 3: grill-me Interview (Week 3)

**目标**: 内置追问机制，确保理解需求后再执行

| 模块 | 文件 | 职责 |
|------|------|------|
| Interview Engine | `packages/core/src/interview/engine.ts` | 追问状态机 |
| Question Generator | `packages/core/src/interview/question.ts` | 问题生成 |
| Anti-criteria | `packages/core/src/interview/anti.ts` | 反向追问 |

**Interview 流程**:
```
用户输入
    │
    ▼
OBSERVE: 需求理解检查
    │
    ├─ 清晰 → 跳过 Interview
    │
    └─ 模糊 → 进入 Interview
         │
         ▼
    ┌─────────────────────────────┐
    │  THINK: grill-me 追问       │
    │  - 一次只问一个问题          │
    │  - 给出推荐答案              │
    │  - 沿设计树逐分支走          │
    └─────────────────────────────┘
         │
         ▼
    所有分支明确 → 继续执行
```

**验证标准**: 输入模糊需求，能追问直到明确

### Phase 4: Review Agent + Anti-criteria (Week 4)

**目标**: 自动触发反方视角评审，发现方案漏洞

| 模块 | 文件 | 职责 |
|------|------|------|
| Review Agent | `packages/core/src/review/agent.ts` | 反方视角评审 |
| Anti-criteria Checker | `packages/core/src/review/anti.ts` | 弊端检查 |
| Verify Phase | `packages/core/src/loop/verify.ts` | 验证阶段 |

**Review 流程**:
```
BUILD 完成
    │
    ▼
VERIFY: 质量检查
    │
    ▼
Review Agent 启动
    │
    ├─ 检查潜在问题
    ├─ 列出弊端和风险
    ├─ 提出改进建议
    │
    ▼
┌─────────────────────────────┐
│  Anti-criteria:              │
│  - 这个方案最大的风险是什么？  │
│  - 如果失败会怎样？           │
│  - 有没有更好的替代方案？      │
└─────────────────────────────┘
    │
    ▼
通过 → 提交
失败 → 返回 THINK 重新规划
```

**验证标准**: 自动发现方案中的潜在问题

### Phase 5: Memory + Learn (Week 5)

**目标**: 跨会话记忆，从经验中学习

| 模块 | 文件 | 职责 |
|------|------|------|
| Memory Store | `packages/core/src/memory/store.ts` | 记忆存储 |
| Memory Recall | `packages/core/src/memory/recall.ts` | 记忆召回 |
| Learn Phase | `packages/core/src/loop/learn.ts` | 学习阶段 |

**验证标准**: 能记住之前的决策和经验

---

## 3. 目录结构

```
licode/
├── packages/
│   └── core/
│       ├── src/
│       │   ├── cli/
│       │   │   └── index.ts          # CLI 入口
│       │   ├── loop/
│       │   │   ├── run.ts            # 主循环
│       │   │   ├── phase.ts          # 七阶段状态机
│       │   │   ├── effort.ts         # Effort Level 路由
│       │   │   ├── observe.ts        # 观察阶段
│       │   │   ├── think.ts          # 思考阶段
│       │   │   ├── plan.ts           # 规划阶段
│       │   │   ├── build.ts          # 构建阶段
│       │   │   ├── execute.ts        # 执行阶段
│       │   │   ├── verify.ts         # 验证阶段
│       │   │   └── learn.ts          # 学习阶段
│       │   ├── session/
│       │   │   ├── session.ts        # Session CRUD
│       │   │   ├── message.ts        # 消息模型
│       │   │   └── schema.ts         # 类型定义
│       │   ├── llm/
│       │   │   ├── client.ts         # LLM 客户端
│       │   │   └── prompt.ts         # System Prompt 构建
│       │   ├── tool/
│       │   │   ├── tool.ts           # 工具接口定义
│       │   │   ├── registry.ts       # 工具注册表
│       │   │   ├── bash.ts           # Shell 工具
│       │   │   ├── read.ts           # 读取工具
│       │   │   ├── write.ts          # 写入工具
│       │   │   └── edit.ts           # 编辑工具
│       │   ├── interview/
│       │   │   ├── engine.ts         # 追问引擎
│       │   │   ├── question.ts       # 问题生成
│       │   │   └── anti.ts           # 反向追问
│       │   ├── review/
│       │   │   ├── agent.ts          # Review Agent
│       │   │   └── anti.ts           # Anti-criteria
│       │   ├── memory/
│       │   │   ├── store.ts          # 记忆存储
│       │   │   └── recall.ts         # 记忆召回
│       │   ├── config/
│       │   │   └── config.ts         # 配置管理
│       │   └── permission/
│       │       └── permission.ts     # 权限控制
│       ├── package.json
│       └── tsconfig.json
├── docs/
│   └── superpowers/
│       └── plans/
│           └── core-loop-plan.md     # 本文件
└── package.json                      # monorepo root
```

---

## 4. 实施顺序

```
Week 1: 最小可用 Core Loop
  ├─ Day 1-2: 项目初始化 (monorepo + TypeScript + Effect)
  ├─ Day 3-4: Session + LLM + Tool 基础
  └─ Day 5:   主循环跑通

Week 2: Effort Level
  ├─ Day 1-2: Effort Router 实现
  ├─ Day 3-4: Phase Controller 状态机
  └─ Day 5:   集成测试

Week 3: Interview
  ├─ Day 1-2: Interview Engine
  ├─ Day 3-4: Question Generator + Anti-criteria
  └─ Day 5:   集成测试

Week 4: Review Agent
  ├─ Day 1-2: Review Agent 实现
  ├─ Day 3-4: Anti-criteria Checker
  └─ Day 5:   集成测试

Week 5: Memory + Polish
  ├─ Day 1-2: Memory Store + Recall
  ├─ Day 3-4: Learn Phase + Skill 自改进
  └─ Day 5:   端到端测试 + 文档
```

---

## 5. 风险和缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Effect-TS 学习曲线陡 | 开发速度慢 | 先用简单实现，逐步 Effect 化 |
| LLM 调用成本高 | 测试费用大 | 本地模型 + Mock 测试 |
| 七阶段过于复杂 | 实现困难 | Phase 1 先做 3 阶段，逐步扩展 |
| Interview 体验差 | 用户流失 | A/B 测试 + 用户反馈迭代 |

---

## 6. 成功标准

- [ ] `licode run "..."` 能完整执行一次对话
- [ ] Effort Level 能自动判断任务复杂度
- [ ] 需求模糊时能追问直到明确
- [ ] Review Agent 能发现方案中的潜在问题
- [ ] 跨会话能记住之前的决策
