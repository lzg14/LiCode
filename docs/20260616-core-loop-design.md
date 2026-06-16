# Pai Core Loop 设计文档

**版本**: v1.0.0
**日期**: 2026-06-16
**状态**: 待评审

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
| **E3** | Medium | 多文件修改、常规开发任务 | Standard |
| **E4** | Deep | 架构变更、多系统协作 | Full Algorithm |
| **E5** | Comprehensive | 关键系统变更、不可逆操作 | Full Algorithm + Interview |

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

### 2.5 E4/E5 强制门禁

E4/E5 任务必须通过以下门禁才能进入 BUILD：

| 门禁 | 要求 |
|------|------|
| **ISA 完整** | 12 个章节必须填充（Problem, Vision, Goal, Criteria 等） |
| **ISC 数量** | E4 >= 128 条, E5 >= 256 条 |
| **Anti-criteria** | >= 1 条（必须识别 failure modes） |
| **审查通过** | Commit-Boundary Advisor 二次确认 |

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

### 6.2 触发时机

| 触发 | 说明 |
|------|------|
| **overflow** | 上下文超过模型限制 |
| **auto** | 上下文接近上限，自动触发 |

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
```

### 6.5 保留机制（Prune）

| 配置 | 默认值 | 说明 |
|------|--------|------|
| `preserve_recent_tokens` | 2000-8000 | 保留最近的 tokens 量 |
| `tail_turns` | 2 | 保留最近的对话轮次 |
| `PRUNE_PROTECT` | 40,000 | 工具输出保护阈值 |

### 6.6 Prune 规则

- 保留最近 40K tokens 的工具输出
- 更早的工具输出删除（除非是 `skill` 工具）
- 工具输出压缩后标记 `compacted: timestamp`

### 6.7 Auto-Continue

压缩完成后，如果 `auto=true`，自动发送：
```
"Continue if you have next steps, or stop and ask for clarification if you are unsure how to proceed."
```

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

自动检测话题切换，提示用户隔离上下文，避免无关信息干扰。

### 7.3 工作流程

```
用户输入 → 话题检测 → 发现新话题
              ↓
    提示用户："切换到新项目 X？"
              ↓
    ┌─────────────────────────┐
    │ 用户确认 / 自动隔离      │
    └─────────────────────────┘
              ↓
    隔离旧上下文 → 开始新话题上下文
```

### 7.4 话题检测算法

| 信号 | 说明 |
|------|------|
| **目录变更** | 当前工作目录与之前不同 |
| **项目路径** | 提及 `/path/to/project-b`，与当前项目无关 |
| **关键词** | "另一个项目"、"新问题"、"顺便问下" |
| **文件路径** | 提及当前项目不存在的文件路径 |

### 7.5 隔离方式

| 方式 | 说明 |
|------|------|
| **用户确认** | 提示用户选择："隔离 / 继续 / 取消" |
| **自动隔离** | 用户设置 `auto_isolate: true` 时自动隔离 |

### 7.6 隔离后的处理

1. 当前上下文压缩存档（保留到 memory）
2. 新话题创建独立上下文
3. 用户可通过 `/return` 返回之前的话题

### 7.7 提示示例

```
<system-reminder>
检测到话题切换：从 "project-A" 切换到 "project-B"
当前上下文已隔离，可通过 /return project-A 返回。
是否继续？
</system-reminder>
```

### 7.8 相关命令

| 命令 | 说明 |
|------|------|
| `/isolate [topic]` | 手动隔离当前话题 |
| `/return [topic]` | 返回之前的话题 |
| `/topics` | 列出所有话题及状态 |
| `/merge [topic1] [topic2]` | 合并两个话题 |

### 7.9 配置项

```yaml
topic:
  auto_detect: true              # 自动检测话题切换
  auto_isolate: false            # 自动隔离（需用户确认）
  detect_signals:                # 检测信号
    - directory_change
    - path_mention
    - keyword_match
    - file_not_found
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

## 9. 异常处理

- 工具执行失败 → 重试（3次，指数退避）
- 循环检测 → 超过 10 次迭代 → 中断 + 报告
- 上下文超限 → 触发压缩 + 归档

---

## 10. 参考项目

- [Personal AI Infrastructure](https://github.com/danielmiessler/Personal_AI_Infrastructure) - Effort Level 系统参考
- [mimo-code](https://github.com/mimo-code/mimo-code) - Memory Recall 和 Compaction 参考
- [Claude Code](https://github.com/anthropics/claude-code) - 上下文管理参考（闭源）
- [Hermes Agent](https://github.com/NousResearch/hermes-agent) - 子 Agent 安全限制参考
- [awesome-ai-anatomy](https://github.com/awesome-ai-anatomy/awesome-ai-anatomy) - 源码分析