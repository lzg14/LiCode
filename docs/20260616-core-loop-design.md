# Pai Core Loop 设计文档

**版本**: v1.4.0
**日期**: 2026-06-17
**状态**: 强化需求理解机制

---

## 0. 核心理念

**宁可慢，不要白干。宁可多问，不要假设。**

- 不理解就反复问，直到理解清楚
- 不清楚就默认走完整流程
- 做出来发现不是想要的 = 垃圾 = 浪费

**强制理解原则**：
- E1/E2：影响范围明确，可以快速执行
- E3+：**强制需求澄清**，不理解不继续
- E4/E5：**强制 Interview**，必须完整理解才能动手

---

## 1. 概述

本文档描述 Pai 的 Core Loop 设计，参考了以下项目的最佳实践：
- **PAI (Personal AI Infrastructure)** - Effort Level 路由系统
- **mimo-code** - Memory Recall 和 Compaction 机制
- **Claude Code** - 上下文管理策略
- **Hermes Agent** - 子 Agent 安全限制

---

## 2. Effort Level 路由

### 2.1 核心思想

不是每个任务都需要完整走 7 阶段。复杂任务走完整流程，简单任务走压缩路径。

```
用户输入 → 分类器 → 路由到不同路径
                    │
    ┌────────────────┼────────────────┐
    ↓                ↓                ↓
  E1 (Minimal)    E2-E3 (Normal)    E4-E5 (Complex)
    ↓                ↓                ↓
 Fast-path       Standard Loop    Full Algorithm
```

### 2.2 Effort Level 定义

| 等级 | 复杂度 | 场景示例 | 路径 |
|------|--------|---------|------|
| **E1** | Minimal | 简单命令、单工具调用、纯查询 | Fast-path |
| **E2** | Light | 简单修改、单文件、已知模式 | Standard |
| **E3** | Medium | 多文件修改、常规开发任务 | Standard + **需求确认** |
| **E4** | Deep | 架构变更、多系统协作 | Full Algorithm + **强制 Interview** |
| **E5** | Comprehensive | 关键系统变更、不可逆操作 | Full Algorithm + **完整 Interview** |

### 2.3 Mode 压缩路径

| Mode | 触发条件 | 阶段路径 |
|------|---------|---------|
| **Fast-path** | E1 + 单工具调用 | OBSERVE → EXECUTE → VERIFY |
| **Research** | E1/E2 + 分析/审查（无代码变更） | OBSERVE → THINK → EXECUTE → VERIFY → LEARN |
| **Standard** | 默认（E2-E3） | 完整 7 阶段 |
| **Full Algorithm** | E4-E5 | 完整 7 阶段 + ISA + 验证门禁 |

### 2.4 E1 判定规则（Fast-path）

满足以下任一条件 → Fast-path：
- 简单命令：`git status`、`ls -la`
- 单工具调用：直接可执行，无需推理
- 纯查询：无副作用，只读操作
- 用户明确说"快点"、"简单弄一下"

**最低 Effort Level 保护：**
- Fast-path 最高只能到 E1，即使用户说"快点"也不能绕过 E2+ 任务的完整流程
- 判定为 E2+ 的任务会强制走完整流程，即使用户说"快点"
- 防止复杂任务被错误降级

### 2.5 E4/E5 强制门禁

E4/E5 任务必须通过以下门禁才能进入 BUILD：

| 门禁 | 要求 |
|------|------|
| **需求理解** | **必须完整澄清需求**，不清楚就反复问，直到理解 |
| **ISA 完整** | 12 个章节必须填充 |
| **ISC 数量** | E4 >= 128 条, E5 >= 256 条 |
| **Anti-criteria** | >= 1 条（必须识别 failure modes） |
| **审查通过** | Commit-Boundary Advisor 二次确认 |

**核心原则**：
- **不理解不继续**：需求不清晰，强制 Interview，直到完全理解
- **做出来发现不是想要的 = 失败**：宁可多问，不要假设

#### ISA 的 12 个章节

| # | 章节 | 说明 |
|---|------|------|
| 1 | **Problem** | 问题定义 - 描述要解决的核心问题 |
| 2 | **Vision** | 愿景 - 描述目标状态是什么样子 |
| 3 | **Out of Scope** | 范围外 - 明确不包含的内容 |
| 4 | **Principles** | 设计原则 - 指导决策的原则 |
| 5 | **Constraints** | 约束条件 - 技术、时间、资源等约束 |
| 6 | **Goal** | 具体目标 - 可测量的目标 |
| 7 | **Criteria** | 验收标准 - 如何判断完成 |
| 8 | **Test Strategy** | 测试策略 - 如何验证 |
| 9 | **Features** | 功能列表 - 需要实现的功能 |
| 10 | **Decisions** | 决策记录 - 关键决策及理由 |
| 11 | **Changelog** | 变更记录 - 追踪变更历史 |
| 12 | **Verification** | 验证结果 - 实际验证的证据 |

#### ISC 数量标准来源

ISC（Ideal State Criteria）是验证的原子单元。E4/E5 对 ISC 数量的要求：
- **E4 >= 128 条**：深度任务需要详细分解，确保每个细节都被验证
- **E5 >= 256 条**：综合任务更复杂，需要更细致的分解

这是 PAI 的经验值，用于确保任务被充分拆解，避免遗漏关键验收点。

---

## 3. 七阶段循环

### 3.1 阶段图

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

### 3.2 各阶段职责

| 阶段 | 输入 | 处理 | 输出 |
|------|------|------|------|
| **OBSERVE** | 用户输入 + 上下文 | 解析意图 + 设置 Effort Level + 选择 capabilities + Memory Recall | 观察报告 + ISA |
| **THINK** | 观察报告 | 分析风险/假设/失败模式 + 搜索记忆 | 思考结果 + 风险列表 |
| **PLAN** | 思考结果 | 决定 scope 策略 + 决定是否 split session | 执行计划 |
| **BUILD** | 执行计划 | 调用工具 + 准备决策 | 执行结果 |
| **EXECUTE** | 执行结果 | 产出实际输出 + 更新 ISA 进度 | 输出交付 |
| **VERIFY** | 输出交付 | 验证质量 + 检查错误 + Live-Probe | 验证报告 |
| **LEARN** | 验证报告 | 更新记忆 + Skill 自改进 + 总结经验 | 学习更新 |

---

## 4. Memory Recall 机制

### 4.1 时机

每次 loop 执行时，在生成 prompt 前检查 session 是否有 memory。

### 4.2 机制

不主动塞给 agent，而是追加一个 recall reminder：

```
<system-reminder>
This session has memory at ~/.pai/memory/sessions/<id>/. Recall content
not in your context with:
- Read(file_path="~/.pai/memory/sessions/<id>/...")
- memory.search(query: "...")

Don't ask the user about something memory may already record.
</system-reminder>
```

### 4.3 设计思路

- **主动 recall** 而非被动注入（类似神经科学的 active recall 原理）
- 降低 token 消耗（只有需要时才查）
- 保持 agent 的自主性（agent 自己决定是否调用 memory.search）

### 4.4 触发条件

- session 有 memory 目录或 tasks 记录
- 每次 prompt 生成时检查

### 4.5 相关配置

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `memory_reconcile_on_search` | true | 搜索前是否 reconcile |
| `memory_search_score_floor` | 0.15 | BM25 评分地板（过滤噪音） |

---

## 5. 上下文管理（4 层）

```
Level 1: 无损删除（丢弃低优先级内容）
Level 2: 缓存隐藏（移出当前窗口但不删除）
Level 3: 结构化归档（存入记忆系统）
Level 4: 完整压缩（保留语义，压缩存储）
```

---

## 6. Compaction 子 Agent 机制

### 6.1 核心思想

上下文溢出时，自动启动 compaction 子 agent 生成摘要，替换历史消息。

### 6.2 触发时机（两阶段压缩）

根据上下文使用率分阶段触发 compaction：

| 压力等级 | 阈值 | 行为 |
|----------|------|------|
| **Level 0** | < 50% | 无操作，正常运行 |
| **Level 1** | 50% - 79% | 触发第一次 compaction（轻量压缩） |
| **Level 2** | >= 80% | 触发第二次 compaction（激进压缩，确保完成） |

**设计思路：**
- 50% 时给第一次缓冲机会，避免频繁触发
- 80% 时确保必须压缩，留紧急 buffer
- 参考 mimo-code 的 `pressureLevel` 机制

**配置项：**
```yaml
compaction:
  auto: true                    # 是否自动触发
  reserve_buffer: 20000          # 保留的 buffer 大小（tokens）
  level1_threshold: 0.50         # 第一阶段阈值（50%）
  level2_threshold: 0.80         # 第二阶段阈值（80%）

### 6.3 Compaction 子 Agent 工作流

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

### 6.4 摘要模板

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

## Context Assessment

[评估上下文增长的原因，帮助判断是否需要优化]

- **Large Project**: 上下文增长是否因为项目本身较大（代码库大、依赖多）
- **Context Leak**: 是否有不必要的上下文残留（如已完成的无关任务）
- **Optimization Opportunity**: 是否有压缩优化空间（如重复的 tool 输出）

**示例**：
```
- Large Project: ✅ 是，项目包含 50+ 文件的微服务架构
- Context Leak: ❌ 否，无关任务已清理
- Optimization Opportunity: ⚠️ 部分工具输出可精简（如 test 输出）
```
```

### 6.5 保留机制（Prune）

| 配置 | 默认值 | 说明 |
|------|--------|------|
| `preserve_recent_tokens` | 4000 | 保留最近的 tokens 量（动态范围 2000-8000） |
| `tail_turns` | 2 | 保留最近的对话轮次 |
| `PRUNE_PROTECT` | 40,000 | 工具输出保护阈值 |

### 6.6 Prune 规则

- 保留最近 40K tokens 的工具输出
- 更早的工具输出删除（除非是 `skill` 工具）
- 工具输出压缩后标记 `compacted: timestamp`

**skill 工具特殊保护原因：**
skill 工具输出包含 Skill 定义、指令和最佳实践，是 Skill 自改进机制的核心。删除会导致 Skill 的进化历史丢失、后续无法回溯改进过程。

### 6.7 Auto-Continue

压缩完成后，如果 `auto=true`，自动发送：
```
"Continue if you have next steps, or stop and ask for clarification if you are unsure how to proceed."
```

**无限循环保护：**
- 每次 Auto-Continue 计数
- 连续 3 次 Auto-Continue 后停止自动发送，改为提示用户
- 用户需要明确回复才能继续
- 防止压缩后继续 → 又压缩 → 又继续的死循环

### 6.8 配置项

```yaml
compaction:
  preserve_recent_tokens: 4000  # 保留最近的 tokens
  tail_turns: 2                 # 保留最近的对话轮次
  prune: true                   # 是否启用 prune
  auto_continue: true           # 压缩后自动继续
```

---

## 7. 多话题隔离机制（Multi-Topic Isolation）

### 7.1 痛点

用户在一个 session 中可能突然问另一个项目的问题，导致上下文混杂，影响回答质量。

### 7.2 核心思想

采用**消息标记 + 动态过滤**方案，在消息级别打 `topic` 标签，过滤时只看当前话题。

### 7.3 数据模型

```typescript
interface Message {
  id: string
  topic: string           // "project-a" | "project-b" | "default"
  topic_status: "active" | "archived"
  content: string
  archived_at?: number    // 存档时间戳
}
```

### 7.4 工作流程

```
用户说 "切到 project-B"
      ↓
当前话题 project-A 的消息标记为 archived
      ↓
只加载 project-B 的消息到上下文
      ↓
project-A 的消息存入 memory
```

### 7.5 话题检测算法

| 信号 | 说明 | 实现 |
|------|------|------|
| **目录变更** | 当前工作目录与之前不同 | 监控 `cwd` 变化 |
| **项目路径** | 提及 `/path/to/project-b` | 正则匹配路径模式 |
| **关键词** | "另一个项目"、"新问题" | 关键词列表匹配 |
| **文件路径** | 提及当前项目不存在的文件 | 检查文件是否存在 |

**检测优先级：**
1. 目录变更（最可靠）
2. 文件不存在（较可靠）
3. 关键词（辅助）
4. 项目路径提及（辅助）

### 7.6 隔离后的处理

| 操作 | 说明 |
|------|------|
| **存档** | 当前话题的消息标记为 `archived`，存入 memory |
| **恢复** | `/return topic-name` 从 memory 加载并标记为 `active` |
| **合并** | `/merge topic1 topic2` 将两个话题的消息合并 |

### 7.7 相关命令

| 命令 | 说明 |
|------|------|
| `/isolate [topic]` | 手动隔离当前话题 |
| `/return [topic]` | 返回之前的话题 |
| `/topics` | 列出所有话题及状态 |
| `/merge [topic1] [topic2]` | 合并两个话题 |
| `/archive [topic]` | 归档话题（不删除，仅存档） |
| `/delete [topic]` | 删除话题 |

### 7.8 提示示例

```
<system-reminder>
检测到话题切换：从 "project-A" 切换到 "project-B"
当前上下文已隔离，可通过 /return project-A 返回。
是否继续？
</system-reminder>
```

### 7.9 配置项

```yaml
topic:
  auto_detect: true              # 自动检测话题切换
  auto_isolate: false            # 自动隔离（需用户确认）
  detect_signals:                # 检测信号（按优先级）
    - directory_change
    - file_not_found
    - keyword_match
    - path_mention
  max_topics: 10                # 最大话题数（超出后提示清理）
  auto_archive_threshold: 0.8    # 话题存档阈值（上下文超过 80%）
```

---

## 8. Reasoning 分层压缩

### 8.1 痛点

每次请求发送完整的历史 reasoning 非常占 token，但完全丢弃又丢失推理链。

### 8.2 核心思想

按层级保留 reasoning：近几轮完整 > 更早的摘要 > 更久的结论。

### 8.3 分层策略

```
┌─────────────────────────────────────────────────────────────┐
│                   Reasoning 分层                            │
│                                                              │
│   最近 N 轮 ──→ 完整保留 reasoning                         │
│        ↓                                                    │
│   更早的 ──→ 摘要保留（保留关键步骤 + 结论）                 │
│        ↓                                                    │
│   更久的 ──→ 仅保留结论（不发送 reasoning）                  │
└─────────────────────────────────────────────────────────────┘
```

### 8.4 分层配置

| 层级 | 保留内容 | 触发条件 |
|------|----------|----------|
| Layer 1 | 完整 reasoning | 最近 3 轮 |
| Layer 2 | 摘要（关键步骤 + 结论） | 4-10 轮 |
| Layer 3 | 仅结论 | 超过 10 轮 |

### 8.5 摘要格式

```markdown
## Reasoning Summary
- 关键推理步骤：[step1, step2, step3]
- 最终结论：[conclusion]
- 依赖信息：[dependencies]
```

### 8.6 压缩时机

| 时机 | 说明 |
|------|------|
| **Compaction 时** | 顺便压缩 reasoning |
| **Reasoning 超限** | 单次 reasoning 超过阈值 |
| **轮次触发** | 超过保留轮次自动压缩 |

### 8.7 配置项

```yaml
reasoning:
  preserve_recent_turns: 3      # 保留最近 3 轮的完整 reasoning
  summarize_older: true        # 更早的 reasoning 摘要
  max_reasoning_tokens: 8000    # 单次 reasoning 上限
  compression_trigger:          # 触发条件
    - on_compaction
    - on_overflow
    - on_turn_threshold
```

---

## 9. 异常处理矩阵

### 9.1 异常分类

| 类别 | 异常场景 | 处理方式 | 恢复策略 |
|------|----------|----------|----------|
| **工具执行** | 工具调用失败 | 重试（3次，指数退避） | 降级或跳过 |
| **循环检测** | 超过 10 次迭代 | 中断 + 报告 | 用户确认后继续 |
| **上下文** | 上下文超限 | 触发 compaction | 分层压缩 |
| **子 Agent** | 子 agent 启动失败 | 回退到主 agent | 记录错误，继续 |
| **内存/存储** | Memory 写入失败 | 警告 + 降级写入 | 磁盘文件兜底 |
| **用户交互** | 用户取消任务 | 存档状态 + 优雅退出 | 保存 checkpoint |
| **网络/IO** | 网络错误、IO 异常 | 重试 + 降级 | 本地缓存 + 重试 |
| **权限/安全** | 权限不足、越界访问 | 拒绝 + 报告 | 提示用户授权 |

### 9.2 重试策略

```typescript
const RETRY_CONFIG = {
  maxAttempts: 3,
  backoffMultiplier: 2,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
}

// 指数退避：1s → 2s → 4s
```

### 9.3 循环检测

| 配置 | 默认值 | 说明 |
|------|--------|------|
| `maxIterations` | 10 | 单次任务最大迭代次数 |
| `iterationWarning` | 7 | 发出警告的阈值 |
| `iterationBlock` | 10 | 强制中断的阈值 |

### 9.4 用户取消处理

```
用户发送 SIGINT / 按下 Ctrl+C
      ↓
保存当前 checkpoint（state + messages）
      ↓
优雅退出（"任务已保存，可通过 /resume 恢复"）
```

### 9.5 降级策略

| 场景 | 降级方案 |
|------|----------|
| Memory 写入失败 | → 降级到本地磁盘文件 |
| LLM API 失败 | → 降级到本地模型 / 返回错误 |
| 网络超时 | → 重试 3 次后返回缓存结果 |
| 工具执行失败 | → 跳过该工具，继续其他步骤 |

---

## 10. 多 Agent 协调机制（Multi-Agent Coordination）

### 10.1 设计背景

opencode 的架构证明：复杂任务需要多个 Agent 协同工作。单个 Agent 受限于单一上下文，多 Agent 可以并行处理不同子任务。

### 10.2 Agent 类型定义

| Agent 类型 | 说明 | 权限 |
|------------|------|------|
| **primary** | 主 Agent，直接与用户交互 | 完整权限 |
| **subagent** | 子 Agent，由 primary 派生 | 受限权限 |
| **fork** | 检查点写入 Agent，复制父上下文 | 受限权限 |

### 10.3 内置 Agent 类型

| Agent | 类型 | 用途 |
|--------|------|------|
| **build** | primary | 主执行 Agent |
| **plan** | primary | 只读计划模式 |
| **explore** | subagent | 代码探索 |
| **compaction** | subagent | 上下文压缩 |
| **checkpoint-writer** | fork | 检查点写入 |
| **dream** | subagent | 创意生成 |
| **distill** | subagent | 内容提炼 |

### 10.4 Spawn 参数

```typescript
interface SpawnInput {
  mode: 'primary' | 'subagent'
  agentType: string
  task: string
  description?: string
  context: 'full' | 'minimal' | 'fork'
  tools: string[] | 'inherit'
  model?: { provider: string; model: string }
  background: boolean
  task_id?: string
  cwd?: string
  timeoutMs?: number
  format?: OutputFormat  // Structured Output
}
```

### 10.5 并发控制

| 配置 | 默认值 | 说明 |
|------|--------|------|
| `maxConcurrentAgents` | 16 | 单次运行最大并发 Agent 数 |
| `maxLifecycleAgents` | 1000 | 整个生命周期最大 Agent 数（硬上限） |
| `agentTimeoutMs` | undefined | 单个 Agent 超时（默认无限） |
| `maxPreReact` | 3 | 单次 Spawn 最大 ReAct 重入次数 |
| `maxPostReact` | 3 | Stop 后最大 ReAct 重入次数 |

### 10.6 Fork Context（上下文复制）

当 spawn fork 类型 Agent 时，复制父 Agent 的完整上下文：

```typescript
interface ForkContext {
  system: string[]           // 系统提示
  tools: Tool[]              // 工具 schema
  parentPermission: Permission.Ruleset  // 父权限
  inheritedMessages: ModelMessage[]     // 消息历史
  watermarkMsgID: string      // 水印标记
  model: { providerID, modelID }
}
```

**用途**：检查点写入 Agent 需要看到与父 Agent 相同的上下文。

### 10.7 Structured Output

支持 schema-based 结构化输出：

```typescript
interface StructuredOutputRequest {
  format: {
    type: 'json_schema'
    name: string
    schema: object
  }
}

// Agent 返回格式
interface AgentOutcome {
  status: 'success' | 'partial' | 'failed' | 'blocked'
  finalText?: string
  structured?: unknown  // 验证后的结构化对象
  incompleteTasks?: string[]
}
```

---

## 11. Task 生命周期管理

### 11.1 Task 状态机

```
         create
    ┌──────────────┐
    │   pending    │
    └──────┬───────┘
           │ start
           ▼
    ┌──────────────┐
    │   running    │◄─────┐
    └──────┬───────┘      │
           │              │
     ┌─────┴─────┐        │
     │           │        │
     ▼           ▼        │ continue
  block      unblock      │
    │           │        │
    └─────┬─────┘        │
          │              │
          ▼              │
    ┌──────────────┐     │
    │   waiting    │─────┘
    └──────┬───────┘
           │
           ▼
    ┌──────────────┐
    │    done      │ (terminal)
    └──────────────┘

    abandon ──► abandoned (terminal)
```

### 11.2 Task 操作

| 操作 | 说明 |
|------|------|
| `create` | 创建 Task |
| `start` | 开始执行 |
| `block` | 阻塞等待 |
| `unblock` | 解锁继续 |
| `done` | 标记完成 |
| `abandon` | 放弃任务 |
| `rename` | 重命名 |

### 11.3 Task 层级

- Task ID 格式：`T1.T1.1`（树形层级）
- 支持 parent_task_id 关联
- 支持 task_id 绑定用户任务

### 11.4 Task 事件

每个 Task 维护事件日志：

```typescript
interface TaskEvent {
  id: string
  task_id: string
  at: number
  kind: 'created' | 'started' | 'blocked' | 'unblocked' | 'done' | 'abandoned'
  summary?: string
}
```

### 11.5 清理策略

```yaml
task:
  archive_days: 7      # 归档前保留天数
  cleanup_days: 7      # 清理前保留天数
```

---

## 12. Session 嵌套机制

### 12.1 Session 类型

| 类型 | 说明 |
|------|------|
| **parent session** | 顶层会话，直接与用户交互 |
| **child session** | 子会话，由 spawn 创建 |

### 12.2 Session 层级

```
用户 Session (parent)
    │
    ├── Agent A (subagent) → Session A (child)
    │       │
    │       └── Task → Session B (grandchild)
    │
    └── Agent B (subagent) → Session C (child)
```

### 12.3 Session 隔离

- child session 写入 parent 的 checkpoint/memory
- parent session 可查看所有 child session 状态
- child session 共享 parent 的 memory 路径权限

### 12.4 Checkpoint 机制

```typescript
interface Checkpoint {
  session_id: string
  parent_id?: string
  state: SessionRunState
  messages: ModelMessage[]
  created_at: number
}
```

---

## 14. 参考项目

| 项目 | 参考内容 | 说明 |
|------|----------|------|
| **Personal AI Infrastructure** | Effort Level 系统 | 核心参考：E1-E5 分级、Mode 压缩路径 |
| **mimo-code** | Memory Recall、Compaction | 核心参考：两阶段压缩、摘要模板、Prune 机制 |
| **opencode** | 多 Agent 协调 | 核心参考：Agent 类型、Spawn 机制、Fork Context、Task 状态机 |
| **Claude Code** | 上下文管理策略 | 借鉴：4 层上下文管理（无损删除→缓存隐藏→归档→压缩） |
| **Hermes Agent** | 子 Agent 安全限制 | 启发：子 agent 权限限制、安全扫描 |
| **RTK (Rust Token Killer)** | CLI 输出过滤 | 辅助参考：Shell 输出 token 压缩（60-97%），可作为外部工具集成 |

### 14.1 opencode 关键机制分析

| 机制 | 实现 | Pai 现状 |
|------|------|----------|
| Agent 类型 | build/plan/compose/explore/compaction 等 | 已定义，需实现 |
| MAX_PRE_REACT | 3 | 已设计（Auto-Continue） |
| MAX_LIFECYCLE_AGENTS | 1000 | 需实现 |
| MAX_CONCURRENT | 16 | 需实现 |
| agentTimeoutMs | per-agent timeout | 需实现 |
| Fork Context | 父上下文复制 | 需实现 |
| Structured Output | schema-based | 需实现 |
| Task 状态机 | block/unblock/done/abandon | 需实现 |
| Session 嵌套 | parent/child session | 需实现 |
| **Claude Code** | 上下文管理策略 | 借鉴：4 层上下文管理（无损删除→缓存隐藏→归档→压缩） |
| **Hermes Agent** | 子 Agent 安全限制 | 启发：子 agent 权限限制、安全扫描 |
| **awesome-ai-anatomy** | 源码分析 | 辅助参考：各项目设计分析 |
| **RTK (Rust Token Killer)** | CLI 输出过滤 | 辅助参考：Shell 输出 token 压缩（60-97%），可作为外部工具集成 |

**Claude Code 借鉴说明：**
Claude Code 是闭源产品，以下机制基于 awesome-ai-anatomy 的逆向分析：
- 4 层上下文管理策略
- 工具执行的 RWLock 机制
- 工具工厂函数模式（buildTool()）