# Skills 系统设计

**版本**: v1.0.0
**日期**: 2026-06-17
**参考**: opencode, hermes-agent

---

## 1. Skill 结构

```
skill-name/
├── SKILL.md           # Skill 定义（描述、触发词、指令）
├── src/               # 源代码
│   └── index.ts       # 入口
├── README.md          # 文档
├── INSTALL.md         # 安装说明
├── VERIFY.md          # 验证测试
└── package.json       # 依赖
```

---

## 2. Skills 分类

| 类别 | 示例 |
|------|------|
| **代码开发** | CodeReview, Refactor, TestGen, CodeSearch, DocGen |
| **任务自动化** | GitFlow, DatabaseOps, FileOrganizer, Scheduler |
| **知识管理** | NoteTaker, KnowledgeGraph, Summarizer, QASystem |
| **多模态** | VoiceIO, ImageUnderstand, DocParser, BrowserAgent |
| **系统** | MemoryManager, SkillMarket, SelfImprove |

---

## 3. 核心能力

| 能力 | 说明 |
|------|------|
| **市场安装** | `skill install <name>` 从市场拉取 |
| **自动发现** | AI 分析任务，自动推荐/安装缺少的 skill |
| **热加载** | 无需重启，运行时加载/卸载 |
| **版本管理** | 依赖锁定，自动更新 |
| **沙箱隔离** | Skill 运行在隔离环境，互不干扰 |

---

## 4. Skill 注册机制（参考 opencode）

```typescript
// Skill 按名称注册
yield* skills.register({
  codeReview: Skill.make({...}),
  refactor: Skill.make({...}),
})

interface Skills {
  register(skills: Record<string, Skill>): Effect<void, Skill.RegistrationError>
}
```

---

## 5. Skill 触发机制

| 触发方式 | 说明 |
|----------|------|
| **显式调用** | 用户 `skill use <name>` |
| **自动发现** | AI 分析任务上下文，自动推荐 |
| **模式匹配** | 触发词匹配 |
| **上下文推断** | 根据项目类型、文件状态推断 |

---

## 6. 自改进技能（参考 hermes-agent）

### 6.1 设计理念

Skill 不是静态的，而是"活"的——执行后会根据结果自我改进。

### 6.2 自改进循环

```
┌─────────────────────────────────────────────────────────────┐
│                    Skill 自改进循环                          │
│                                                              │
│   执行 Skill ──→ 成功 ──→ 记录最佳实践到 Skill               │
│       │                                                     │
│       └──→ 失败 ──→ 自我反思 ──→ Patch Skill in-place        │
│                       │                                     │
│                       └──→ 复杂任务 ──→ 自动创建新 Skill      │
└─────────────────────────────────────────────────────────────┘
```

### 6.3 三种自改进机制

| 机制 | 触发条件 | 行为 |
|------|----------|------|
| **Skill Patch** | Skill 执行失败 | 反思失败原因，补丁更新到 Skill |
| **Skill Create** | 复杂任务完成无对应 Skill | 自动创建新 Skill |
| **Best Practice Update** | Skill 执行成功 | 总结本次最佳实践，更新 Skill |

### 6.4 安全机制

- 每次 patch 前扫描内容，防止 prompt injection
- Skill 写入前安全校验
- 子 agent 限制（无代码执行、无内存写入、无用户交互）

### 6.5 沙箱隔离机制

Skill 运行在隔离环境中，互不干扰：

```
┌─────────────────────────────────────────────────────────────┐
│                    Skill 沙箱                             │
│                                                       │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐          │
│  │ Skill A │    │ Skill B │    │ Skill C │          │
│  └────┬────┘    └────┬────┘    └────┬────┘          │
│       │             │             │                      │
│       └─────────────┼─────────────┘                      │
│                     ▼                                    │
│            ┌────────────────┐                          │
│            │  Tool Access   │                          │
│            │   Bridge      │                          │
│            └────────┬───────┘                          │
│                     │                                   │
│         ┌─────────┼─────────┐                        │
│         ▼           ▼           ▼                        │
│    ┌────────┐  ┌────────┐  ┌────────┐              │
│    │ Read   │  │ Write  │  │ Exec   │              │
│    │ 允许   │  │ 审批   │  │ 禁止   │              │
│    └────────┘  └────────┘  └────────┘              │
└───────────────────────────────────────────────────────┘
```

**隔离级别**：

| 级别 | 文件访问 | 网络访问 | 执行命令 | 示例 |
|------|----------|----------|-----------|------|
| L1 | 只读项目目录 | 无 | 无 | CodeReview |
| L2 | 读写项目目录 | 只读 | 只读命令 | Refactor |
| L3 | 任意目录 | 读+特定白名单 | 白名单命令 | GitFlow |
| L4 | 完全访问 | 完全访问 | 完全访问 | SystemAdmin |

**隔离实现**：
| 机制 | 说明 |
|------|------|
| 进程隔离 | 每个 Skill 运行在独立进程 |
| 文件系统限制 | 工作目录限制在项目内 |
| 网络限制 | 仅允许配置的域名 |
| 命令白名单 | 仅允许配置的 Shell 命令 |
| 超时控制 | 单次执行超时限制 |

---

| 方面 | Tool | Skill |
|------|------|-------|
| **粒度** | 原子操作 | 复杂任务流 |
| **调用方式** | Agent 调用 | 用户触发/Agent 推荐 |
| **可改进** | 否 | 是 |
| **持久化** | 代码固定 | 可自改进 |
| **示例** | Read, Write, Grep | CodeReview, Refactor |

### 7.1 Skill 调用 Tool 机制

Skill 执行时通过 Tool Bridge 调用底层工具：

```
┌─────────────────────────────────────────────────────────────┐
│                    Skill 执行流程                            │
│                                                       │
│  Skill 指令                                            │
│      │                                                 │
│      ▼                                                 │
│  解析 Skill 步骤                                        │
│      │                                                 │
│      ▼                                                 │
│  依次调用 Tool                                          │
│      │                                                 │
│      ▼                                                 │
│  Tool Bridge                                           │
│      │                                                 │
│      ├── Read/Write/Grep ──► Tools 系统                 │
│      └── Bash/Exec ──────────► Security 检查              │
└───────────────────────────────────────────────────────┘
```

**Tool Bridge 职责**：

| 职责 | 说明 |
|------|------|
| 参数转换 | Skill 参数 → Tool 输入 |
| 结果格式化 | Tool 输出 → Skill 可理解格式 |
| 错误处理 | Tool 失败 → Skill 可重试 |
| 权限桥接 | Skill L级别 → Tool 权限 |

---

## 8. Skill 指令格式（参考 hermes）

```markdown
# Skill: prometheus-setup
## 触发词
- setup prometheus
- 部署 prometheus
## 指令
1. 安装 Prometheus
2. 配置 Grafana
3. 设置监控面板
## 最佳实践（自动更新）
- 使用 docker-compose 部署
- 默认端口 9090
## 历史版本
- v1: 初始版本
- v2: 优化安装步骤（2026-06-17）
```

---

## 9. 热加载机制

```typescript
interface SkillHotReload {
  watch: (skillPath: string) => void
  unload: (skillName: string) => Effect<void>
  reload: (skillName: string) => Effect<Skill>
}
```

---

## 10. 版本控制

| 功能 | 说明 |
|------|------|
| 自动版本记录 | 每次 patch 自动记录 |
| 回滚支持 | 支持回滚到任意版本 |
| diff 查看 | `skill diff <name>` |
