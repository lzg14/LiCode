# Pai - Personal AI OS

**版本**: v1.0.0
**日期**: 2026-06-16
**状态**: 待评审

---

## 1. 概述

### 1.1 项目定位

**Pai** 是一个类 PAI (Personal AI Infrastructure) 的个人 AI 操作系统，基于开源技术栈，参考 Claude Code、oh-my-claudecode、mimo-code 的设计理念。

### 1.2 核心价值

- **代码开发为主** - 覆盖写/审/重构/搜索/文档/测试全流程
- **本地优先** - 敏感数据不出门
- **开放生态** - 开源 + Skills 市场 + 社区贡献

### 1.3 设计原则

- 文本优于存储
- 上下文脚手架 > 模型能力
- 轻量级，笔记本能跑
- 模块化，可插拔

---

## 2. 核心架构

### 2.1 模块划分

| 模块 | 职责 |
|------|------|
| **Core Loop** | Agent 主循环，调度所有能力（七阶段） |
| **Memory System** | 三层记忆，AI 主动管理 |
| **Skills Engine** | 技能加载、执行、发现、市场 |
| **Integration Layer** | Git/DB/Notes 集成适配器 |
| **Knowledge Graph** | 知识组织和语义检索 |
| **Tools Manager** | 40+ 内置工具管理 |
| **LLM Bridge** | 多 LLM 提供者支持 |
| **Multimodal Bridge** | 语音/图像/文档/浏览器 |

### 2.2 数据流

```
User Input → Core Loop → Memory (check) → Plan → Tools/Knowledge → Execute → Memory (update) → Response
```

### 2.3 技术栈

| 组件 | 技术 |
|------|------|
| 语言 | TypeScript + Bash |
| 运行时 | Bun |
| 数据库 | SQLite FTS5 |
| 存储 | 本地 Markdown 文件 |
| 框架 | Turborepo (monorepo) |

---

## 3. 记忆系统设计

### 3.1 三层记忆

| 层级 | 容量 | 生命周期 | 存储方式 |
|------|------|---------|----------|
| **短期记忆** | 最近 10 次交互 | Session | 内存 |
| **中期记忆** | 当前项目上下文 | 项目周期 | SQLite |
| **长期记忆** | 永久知识 | 永久 | Markdown + 向量索引 |

### 3.2 Scope 和 Type（参考 mimo-code）

**Scope（作用域）**：
- `global` - 全局记忆
- `projects` - 项目级记忆
- `sessions` - 会话级记忆
- `cc` - 兼容 Claude Code 格式

**MemoryType（记忆类型）**：
- `memory` - AI 主动记忆
- `notes` - 用户笔记
- `checkpoint` - 关键检查点
- `progress` - 进度追踪
- `feedback` - 反馈/改进

### 3.3 存储架构

```
Memory System (mimo-code 风格)
├── SQLite FTS5  → 全文索引 + BM25 搜索
├── Markdown     → 磁盘文件（与 DB 双向同步）
└── 指纹缓存     → 避免重复索引
```

### 3.4 AI 主动管理机制

- 每次交互后，AI 判断哪些信息值得升级到中期/长期记忆
- 长期记忆自动过期机制（30天未访问自动归档）
- 记忆压缩：相似记忆自动合并

---

## 4. Skills 系统设计

### 4.1 Skill 结构

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

### 4.2 Skills 分类

| 类别 | 示例 |
|------|------|
| **代码开发** | CodeReview, Refactor, TestGen, CodeSearch, DocGen |
| **任务自动化** | GitFlow, DatabaseOps, FileOrganizer, Scheduler |
| **知识管理** | NoteTaker, KnowledgeGraph, Summarizer, QASystem |
| **多模态** | VoiceIO, ImageUnderstand, DocParser, BrowserAgent |
| **系统** | MemoryManager, SkillMarket, SelfImprove |

### 4.3 核心能力

| 能力 | 说明 |
|------|------|
| **市场安装** | `skill install <name>` 从市场拉取 |
| **自动发现** | AI 分析任务，自动推荐/安装缺少的 skill |
| **热加载** | 无需重启，运行时加载/卸载 |
| **版本管理** | 依赖锁定，自动更新 |
| **沙箱隔离** | Skill 运行在隔离环境，互不干扰 |

### 4.4 自改进技能（参考 Hermes Agent）

**设计理念：**
Skill 不是静态的，而是"活"的——执行后会根据结果自我改进。

**自改进循环（Reflexion + Voyager 风格）：**
```
┌─────────────────────────────────────────────────────────────┐
│                    Skill 自改进循环                          │
│                                                              │
│   执行 Skill ──→ 成功 ──→ 记录最佳实践到 Skill               │
│       │                                                     │
│       └──→ 失败 ──→ 自我反思 ──→ Patch Skill in-place        │
│                       │                                    │
│                       └──→ 复杂任务 ──→ 自动创建新 Skill      │
└─────────────────────────────────────────────────────────────┘
```

**Skill 本质（参考 Hermes）：**
Skill 就是一个 Markdown 文件，包含指令和代码片段，类似 human 的 runbook。
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
- v2: 优化安装步骤（2026-06-16）
```

**三种自改进机制：**

| 机制 | 触发条件 | 行为 |
|------|----------|------|
| **Skill Patch** | Skill 执行失败 | 反思失败原因，补丁更新到 Skill |
| **Skill Create** | 复杂任务完成无对应 Skill | 自动创建新 Skill |
| **Best Practice Update** | Skill 执行成功 | 总结本次最佳实践，更新 Skill |

**自改进流程详解：**

1. **Patch（失败后）**
   ```
   用户: "部署 Prometheus"
   Skill: prometheus-setup 执行
   结果: 失败（端口冲突）
   反思: "端口 9090 被占用，应该先检查端口或使用备用端口"
   Patch: 更新 SKILL.md 添加端口检查步骤
   ```

2. **Create（无对应 Skill）**
   ```
   用户: "配置 Kubernetes 监控栈"
   Skill: 无对应
   结果: 任务完成
   反思: "这是个通用任务，值得创建 Skill"
   Create: 创建 k8s-monitoring-setup Skill
   ```

3. **Update（成功后）**
   ```
   用户: "部署 Redis 集群"
   Skill: redis-setup 执行
   结果: 成功，发现新优化点
   Update: 更新 SKILL.md 添加"使用集群模式"最佳实践
   ```

**安全机制（参考 Hermes memory-threat-detection）：**
- 每次 patch 前扫描内容，防止 prompt injection
- Skill 写入前安全校验
- 子 agent 限制（无代码执行、无内存写入、无用户交互）

**版本控制：**
- 每次 patch 自动记录版本历史
- 支持回滚到任意版本
- `skill diff <name>` 查看变更

---

## 5. 集成层设计

### 5.1 集成架构

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

### 5.2 核心接口

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

## 6. 工具系统设计

### 6.1 工具分类

| 类别 | 工具数 | 示例 |
|------|--------|------|
| **代码编辑** | 8 | Read, Edit, Write, Delete, Move, Copy, Glob, Grep |
| **Git 操作** | 6 | GitStatus, GitCommit, GitPush, GitPull, GitBranch, GitMerge |
| **代码审查** | 4 | CodeReview, BugScan, SecurityScan, PerfAnalyze |
| **测试** | 4 | RunTests, GenTests, Coverage, Benchmark |
| **数据库** | 5 | Query, Execute, Migrate, Backup, Restore |
| **文件操作** | 6 | Mkdir, Rm, Cp, Mv, Zip, Unzip |
| **搜索** | 4 | WebSearch, CodeSearch, DocSearch, SemanticSearch |
| **Shell** | 3 | Bash, Run, Exec |

### 6.2 工厂函数模式（参考 Claude Code）

```typescript
function buildTool<I, O>(config: ToolConfig<I, O>): Tool<I, O> {
  return {
    id: config.id,
    name: config.name,
    description: config.description,
    inputSchema: config.inputSchema,
    outputSchema: config.outputSchema,
    execute: config.execute,
    retryPolicy: config.retryPolicy,
    timeout: config.timeout,
  }
}
```

### 6.3 RWLock 机制

- 读工具并行执行（多个读取同时进行）
- 写工具独占锁（防止并发写冲突）
- 读等待写释放，写等待读完成

---

## 7. Core Loop 设计

### 7.1 Effort Level 路由（参考 PAI Algorithm v6.3.0）

**核心思想：** 不是每个任务都需要完整走 7 阶段。复杂任务走完整流程，简单任务走压缩路径。

```
用户输入 → 分类器 → 路由到不同路径
                    │
    ┌────────────────┼────────────────┐
    ↓                ↓                ↓
  E1 (Minimal)    E2-E3 (Normal)    E4-E5 (Complex)
    ↓                ↓                ↓
 Fast-path       Standard Loop    Full Algorithm
```

### 7.2 Effort Level 定义

| 等级 | 复杂度 | 场景示例 | 路径 |
|------|--------|---------|------|
| **E1** | Minimal | 简单命令、单工具调用、纯查询 | Fast-path |
| **E2** | Light | 简单修改、单文件、已知模式 | Standard |
| **E3** | Medium | 多文件修改、常规开发任务 | Standard |
| **E4** | Deep | 架构变更、多系统协作 | Full Algorithm |
| **E5** | Comprehensive | 关键系统变更、不可逆操作 | Full Algorithm + Interview |

### 7.3 Mode 压缩路径

| Mode | 触发条件 | 阶段路径 |
|------|---------|---------|
| **Fast-path** | E1 + 单工具调用 | OBSERVE → EXECUTE → VERIFY |
| **Research** | E1/E2 + 分析/审查（无代码变更） | OBSERVE → THINK → EXECUTE → VERIFY → LEARN |
| **Standard** | 默认（E2-E3） | 完整 7 阶段 |
| **Full Algorithm** | E4-E5 | 完整 7 阶段 + ISA + 验证门禁 |

### 7.4 E1 判定规则（Fast-path）

满足以下任一条件 → Fast-path：
- 简单命令：`git status`、`ls -la`
- 单工具调用：直接可执行，无需推理
- 纯查询：无副作用，只读操作
- 用户明确说"快点"、"简单弄一下"

### 7.5 E4/E5 强制门禁

E4/E5 任务必须通过以下门禁才能进入 BUILD：

| 门禁 | 要求 |
|------|------|
| **ISA 完整** | 12 个章节必须填充（Problem, Vision, Goal, Criteria 等） |
| **ISC 数量** | E4 >= 128 条, E5 >= 256 条 |
| **Anti-criteria** | >= 1 条（必须识别 failure modes） |
| **审查通过** | Commit-Boundary Advisor 二次确认 |

### 7.6 七阶段循环

```
┌─────────────────────────────────────────────────────────────┐
│                      Core Loop                              │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐  │
│  │OBSERVE  │ →  │ THINK   │ →  │  PLAN   │ →  │  BUILD  │  │
│  │ 观察     │    │ 思考     │    │ 规划     │    │ 执行     │  │
│  └─────────┘    └─────────┘    └─────────┘    └─────────┘  │
│       ↑                                           ↓       │
│       │              ┌─────────┐    ┌─────────┐          │
│       └────────────── │ VERIFY  │ ←  │  LEARN  │          │
│                      │ 验证     │    │ 学习     │          │
│                      └─────────┘    └─────────┘          │
└─────────────────────────────────────────────────────────────┘
```

**各阶段职责：**

| 阶段 | 输入 | 处理 | 输出 |
|------|------|------|------|
| **OBSERVE** | 用户输入 + 上下文 | 解析意图 + 设置 Effort Level + 选择 capabilities + **Memory Recall** | 观察报告 + ISA |
| **THINK** | 观察报告 | 分析风险/假设/失败模式 + 搜索记忆 | 思考结果 + 风险列表 |
| **PLAN** | 思考结果 | 决定 scope 策略 + 决定是否 split session | 执行计划 |
| **BUILD** | 执行计划 | 调用工具 + 准备决策 | 执行结果 |
| **EXECUTE** | 执行结果 | 产出实际输出 + 更新 ISA 进度 | 输出交付 |
| **VERIFY** | 输出交付 | 验证质量 + 检查错误 + Live-Probe | 验证报告 |
| **LEARN** | 验证报告 | 更新记忆 + Skill 自改进 + 总结经验 | 学习更新 |

### 7.6.1 OBSERVE 阶段的 Memory Recall（参考 mimo-code）

**时机：** 每次 loop 执行时，在生成 prompt 前检查 session 是否有 memory。

**机制：** 不主动塞给 agent，而是追加一个 recall reminder：
```
<system-reminder>
This session has memory at ~/.pai/memory/sessions/<id>/. Recall content
not in your context with:
- Read(file_path="~/.pai/memory/sessions/<id>/...")
- memory.search(query: "...")

Don't ask the user about something memory may already record.
</system-reminder>
```

**设计思路：**
- **主动recall**而非被动注入（类似神经科学的 active recall 原理）
- 降低 token 消耗（只有需要时才查）
- 保持 agent 的自主性（agent 自己决定是否调用 memory.search）

**触发条件：**
- session 有 memory 目录或 tasks 记录
- 每次 prompt 生成时检查

**相关配置：**
| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `memory_reconcile_on_search` | true | 搜索前是否 reconcile |
| `memory_search_score_floor` | 0.15 | BM25 评分地板（过滤噪音） |

### 7.7 上下文管理（4 层，参考 Claude Code）

```
Level 1: 无损删除（丢弃低优先级内容）
Level 2: 缓存隐藏（移出当前窗口但不删除）
Level 3: 结构化归档（存入记忆系统）
Level 4: 完整压缩（保留语义，压缩存储）
```

### 7.7.1 Compaction 子 Agent 机制（参考 mimo-code）

**核心思想：** 上下文溢出时，自动启动 compaction 子 agent 生成摘要，替换历史消息。

**触发时机：**
| 触发 | 说明 |
|------|------|
| **overflow** | 上下文超过模型限制 |
| **auto** | 上下文接近上限，自动触发 |

**Compaction 子 Agent 工作流：**
```
┌─────────────────────────────────────────────────────────────┐
│                   Compaction 子 Agent                       │
│                                                              │
│   上下文溢出 ──→ 启动 compaction agent ──→ 生成摘要         │
│       │                                    │                │
│       │                         ┌───────────┴───────────┐   │
│       │                         ↓                       ↓   │
│       │                    替换历史消息           自动继续  │
│       │                         │                       │   │
│       │                         └───────────┬───────────┘   │
│       │                                     ↓               │
│       └─────────────────────────────────→ 继续主循环        │
└─────────────────────────────────────────────────────────────┘
```

**摘要模板（参考 mimo-code）：**
```markdown
## Goal

[What goal(s) is the user trying to accomplish?]

## Instructions

- [What important instructions did the user give you that are relevant]
- [If there is a plan or spec, include information about it so next agent can continue using it]

## Discoveries

[What notable things were learned during this conversation that would be useful for the next agent to know when continuing the work]

## Accomplished

[What work has been completed, what work is still in progress, and what work is left?]

## Relevant files / directories

[Construct a structured list of relevant files that have been read, edited, or created that pertain to the task at hand.]
```

**保留机制（Prune）：**
| 配置 | 默认值 | 说明 |
|------|--------|------|
| `preserve_recent_tokens` | 2000-8000 | 保留最近的 tokens 量 |
| `tail_turns` | 2 | 保留最近的对话轮次 |
| `PRUNE_PROTECT` | 40,000 | 工具输出保护阈值 |

**Prune 规则：**
- 保留最近 40K tokens 的工具输出
- 更早的工具输出删除（除非是 `skill` 工具）
- 工具输出压缩后标记 `compacted: timestamp`

**Auto-Continue：**
压缩完成后，如果 `auto=true`，自动发送：
```
"Continue if you have next steps, or stop and ask for clarification if you are unsure how to proceed."
```

**配置项：**
```yaml
compaction:
  preserve_recent_tokens: 4000  # 保留最近的 tokens
  tail_turns: 2                 # 保留最近的对话轮次
  prune: true                   # 是否启用 prune
  auto_continue: true           # 压缩后自动继续
```

### 7.8 异常处理

- 工具执行失败 → 重试（3次，指数退避）
- 循环检测 → 超过 10 次迭代 → 中断 + 报告
- 上下文超限 → 触发压缩 + 归档

---

## 8. 多模态能力设计

### 8.1 能力矩阵

| 能力 | 技术方案 | 说明 |
|------|----------|------|
| **语音输入** | Whisper（本地） | 离线转文字，保护隐私 |
| **语音输出** | ElevenLabs / XTTS | 自然语音合成 |
| **图像理解** | Claude Vision API | 截图、图表分析 |
| **文档解析** | MarkItDown + PDF.js | PDF/PPT/Word → Markdown |
| **浏览器自动化** | Playwright | 网页操作、数据抓取 |

### 8.2 文档解析支持

| 格式 | 库 | 说明 |
|------|-----|------|
| PDF | pdf-parse + MarkItDown | 提取文本、表格 |
| Word | python-docx | 段落、表格提取 |
| PPT | python-pptx | 幻灯片提取 |
| Excel | openpyxl | 数据表格 |

---

## 9. 部署架构设计

### 9.1 部署形态

| 形态 | 技术栈 | 场景 |
|------|--------|------|
| **Desktop App** | Tauri (Rust + Web) | 图形界面，鼠标操作 |
| **CLI** | Bun + Node.js | 终端，快捷高效 |
| **Web** | 轻量 Web UI（可选） | 远程访问 |

### 9.2 项目结构（monorepo）

```
pai/
├── packages/
│   ├── core/              # 核心逻辑（共享）
│   │   ├── memory/        # 记忆系统
│   │   ├── skills/        # 技能引擎
│   │   ├── tools/         # 工具集
│   │   └── loop/          # 核心循环
│   ├── desktop/           # Tauri 桌面应用
│   ├── cli/               # CLI 工具
│   └── integrations/      # 集成适配器
├── skills/                # 内置 Skills
├── resources/             # 资源文件
└── README.md
```

### 9.3 本地数据存储

```
~/.pai/
├── config.yaml           # 主配置
├── memory/               # 记忆存储（Markdown）
│   ├── global/
│   ├── projects/
│   └── sessions/
├── skills/               # 已安装技能
├── cache/                # 缓存
├── logs/                 # 日志
└── data/
    └── memory.db         # SQLite FTS5
```

### 9.4 安全策略

- API Key 存储在系统密钥链（macOS Keychain / Windows Credential Manager）
- 敏感数据加密存储（AES-256）
- 网络请求可选代理

---

## 10. 实施路线图

### Phase 1: 核心骨架（2-3 周）
- [ ] 项目初始化（Turborepo + Bun）
- [ ] Core Loop 实现（七阶段）
- [ ] 基础工具集（文件操作 + Shell）
- [ ] SQLite FTS5 记忆系统

### Phase 2: 开发能力（2-3 周）
- [ ] Git 集成
- [ ] 代码审查 Skill
- [ ] 数据库集成
- [ ] CLI 完成

### Phase 3: 知识管理（2-3 周）
- [ ] 三层记忆系统
- [ ] 知识图谱
- [ ] 语义搜索
- [ ] Obsidian 集成

### Phase 4: 多模态（2-3 周）
- [ ] Whisper 语音输入
- [ ] 文档解析
- [ ] 浏览器自动化
- [ ] 语音输出

### Phase 5: 生态（持续）
- [ ] Skills 市场
- [ ] 自动发现
- [ ] 桌面应用
- [ ] 社区贡献

### 里程碑

| 阶段 | 目标 | 时间 |
|------|------|------|
| MVP | CLI + Core Loop + 基础工具 + 记忆 | 1 个月 |
| Beta | 开发技能 + 数据库 + Git 集成 | 2 个月 |
| Stable | 多模态 + 知识管理 + 桌面 | 3 个月 |
| v1.0 | Skills 市场 + 生态 | 4-6 个月 |

---

## 11. 参考项目

- [Personal AI Infrastructure](https://github.com/danielmiessler/Personal_AI_Infrastructure) - 项目定位参考
- [mimo-code](https://github.com/mimo-code/mimo-code) - 记忆系统参考
- [oh-my-claudecode](https://github.com/oh-my-code/oh-my-claudecode) - 插件编排参考
- [Claude Code](https://github.com/anthropics/claude-code) - 架构设计参考（闭源）
- [awesome-ai-anatomy](https://github.com/awesome-ai-anatomy/awesome-ai-anatomy) - 源码分析参考

---

## 12. 附录

### A. 工具列表（40+）

**代码编辑（8）**
- Read, Edit, Write, Delete, Move, Copy, Glob, Grep

**Git 操作（6）**
- GitStatus, GitCommit, GitPush, GitPull, GitBranch, GitMerge

**代码审查（4）**
- CodeReview, BugScan, SecurityScan, PerfAnalyze

**测试（4）**
- RunTests, GenTests, Coverage, Benchmark

**数据库（5）**
- Query, Execute, Migrate, Backup, Restore

**文件操作（6）**
- Mkdir, Rm, Cp, Mv, Zip, Unzip

**搜索（4）**
- WebSearch, CodeSearch, DocSearch, SemanticSearch

**Shell（3）**
- Bash, Run, Exec

### B. 内置 Skills 列表

**代码开发**
- CodeReview - 代码审查
- Refactor - 重构优化
- TestGen - 测试生成
- CodeSearch - 代码搜索
- DocGen - 文档生成

**任务自动化**
- GitFlow - Git 工作流
- DatabaseOps - 数据库操作
- FileOrganizer - 文件整理
- Scheduler - 任务调度

**知识管理**
- NoteTaker - 笔记整理
- KnowledgeGraph - 知识图谱
- Summarizer - 摘要生成
- QASystem - 问答系统

**多模态**
- VoiceIO - 语音交互
- ImageUnderstand - 图像理解
- DocParser - 文档解析
- BrowserAgent - 浏览器自动化

**系统**
- MemoryManager - 记忆管理
- SkillMarket - 技能市场
- SelfImprove - 自改进