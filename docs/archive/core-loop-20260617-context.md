# 上下文管理

**版本**: v1.8.0
**日期**: 2026-06-17

---

## 1. Memory Recall 机制

### 1.1 时机

每次 loop 执行时，在生成 prompt 前检查 session 是否有 memory。

### 1.2 机制

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

### 1.3 设计思路

- **主动 recall** 而非被动注入（类似神经科学的 active recall 原理）
- 降低 token 消耗（只有需要时才查）
- 保持 agent 的自主性（agent 自己决定是否调用 memory.search）

### 1.4 触发条件

- session 有 memory 目录或 tasks 记录
- 每次 prompt 生成时检查

### 1.5 相关配置

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `memory_reconcile_on_search` | true | 搜索前是否 reconcile |
| `memory_search_score_floor` | 0.15 | BM25 评分地板（过滤噪音） |

---

## 2. 上下文管理（4 层）

```
Level 1: 无损删除（丢弃低优先级内容）
Level 2: 缓存隐藏（移出当前窗口但不删除）
Level 3: 结构化归档（存入记忆系统）
Level 4: 完整压缩（保留语义，压缩存储）
```

---

## 3. Compaction 子 Agent 机制

### 3.1 核心思想

上下文溢出时，自动启动 compaction 子 agent 生成摘要，替换历史消息。

### 3.2 触发时机（两阶段压缩）

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
```

### 3.3 Compaction 子 Agent 工作流

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

### 3.4 摘要模板

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
```

### 3.5 保留机制（Prune）

| 配置 | 默认值 | 说明 |
|------|--------|------|
| `preserve_recent_tokens` | 4000 | 保留最近的 tokens 量（动态范围 2000-8000） |
| `tail_turns` | 2 | 保留最近的对话轮次 |
| `PRUNE_PROTECT` | 40,000 | 工具输出保护阈值 |

### 3.6 Prune 规则

- 保留最近 40K tokens 的工具输出
- 更早的工具输出删除（除非是 `skill` 工具）
- 工具输出压缩后标记 `compacted: timestamp`

**skill 工具特殊保护原因：**
skill 工具输出包含 Skill 定义、指令和最佳实践，是 Skill 自改进机制的核心。删除会导致 Skill 的进化历史丢失、后续无法回溯改进过程。

### 3.7 Auto-Continue

压缩完成后，如果 `auto=true`，自动发送：
```
"Continue if you have next steps, or stop and ask for clarification if you are unsure how to proceed."
```

**无限循环保护：**
- 每次 Auto-Continue 计数
- 连续 3 次 Auto-Continue 后停止自动发送，改为提示用户
- 用户需要明确回复才能继续
- 防止压缩后继续 → 又压缩 → 又继续的死循环

### 3.8 配置项

```yaml
compaction:
  preserve_recent_tokens: 4000  # 保留最近的 tokens
  tail_turns: 2                 # 保留最近的对话轮次
  prune: true                   # 是否启用 prune
  auto_continue: true           # 压缩后自动继续
```

---

## 4. 多话题隔离机制（Multi-Topic Isolation）

### 4.1 痛点

用户在一个 session 中可能突然问另一个项目的问题，导致上下文混杂，影响回答质量。

### 4.2 核心思想

采用**消息标记 + 动态过滤**方案，在消息级别打 `topic` 标签，过滤时只看当前话题。

### 4.3 数据模型

```typescript
interface Message {
  id: string
  topic: string           // "project-a" | "project-b" | "default"
  topic_status: "active" | "archived"
  content: string
  archived_at?: number    // 存档时间戳
}
```

### 4.4 工作流程

```
用户说 "切到 project-B"
      ↓
当前话题 project-A 的消息标记为 archived
      ↓
只加载 project-B 的消息到上下文
      ↓
project-A 的消息存入 memory
```

### 4.5 话题检测算法

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

### 4.6 隔离后的处理

| 操作 | 说明 |
|------|------|
| **存档** | 当前话题的消息标记为 `archived`，存入 memory |
| **恢复** | `/return topic-name` 从 memory 加载并标记为 `active` |
| **合并** | `/merge topic1 topic2` 将两个话题的消息合并 |

### 4.7 相关命令

| 命令 | 说明 |
|------|------|
| `/isolate [topic]` | 手动隔离当前话题 |
| `/return [topic]` | 返回之前的话题 |
| `/topics` | 列出所有话题及状态 |
| `/merge [topic1] [topic2]` | 合并两个话题 |
| `/archive [topic]` | 归档话题（不删除，仅存档） |
| `/delete [topic]` | 删除话题 |

### 4.8 配置项

```yaml
topic:
  auto_detect: true              # 自动检测话题切换
  auto_isolate: false            # 自动隔离（需用户确认）
  detect_signals:
    - directory_change
    - file_not_found
    - keyword_match
    - path_mention
  max_topics: 10                # 最大话题数（超出后提示清理）
  auto_archive_threshold: 0.8    # 话题存档阈值（上下文超过 80%）
```

---

## 5. Reasoning 分层压缩

### 5.1 痛点

每次请求发送完整的历史 reasoning 非常占 token，但完全丢弃又丢失推理链。

### 5.2 核心思想

按层级保留 reasoning：近几轮完整 > 更早的摘要 > 更久的结论。

### 5.3 分层策略

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

### 5.4 分层配置

| 层级 | 保留内容 | 触发条件 |
|------|----------|----------|
| Layer 1 | 完整 reasoning | 最近 3 轮 |
| Layer 2 | 摘要（关键步骤 + 结论） | 4-10 轮 |
| Layer 3 | 仅结论 | 超过 10 轮 |

### 5.5 摘要格式

```markdown
## Reasoning Summary
- 关键推理步骤：[step1, step2, step3]
- 最终结论：[conclusion]
- 依赖信息：[dependencies]
```

### 5.6 摘要生成机制

**生成者**：
| 场景 | 生成者 | 说明 |
|------|--------|------|
| 正常压缩 | **Compaction 子 Agent** | 专门的压缩 Agent 生成摘要 |
| 紧急压缩 | **主 Agent** | 直接在当前上下文生成摘要 |

**使用模型**：
| 模型 | 使用场景 | 说明 |
|------|----------|------|
| 主模型 | 默认 | 与当前 session 相同的模型 |
| 小模型 | 轻量压缩 | 当 context 超过 80% 时使用更小的模型加速 |

**生成时机**：
- 在 Safe Boundary 之前完成
- 不阻塞当前 Agent 执行
- 异步生成，结果写入 Snapshot

### 5.7 压缩时机

| 时机 | 说明 |
|------|------|
| **Compaction 时** | 顺便压缩 reasoning |
| **Reasoning 超限** | 单次 reasoning 超过阈值 |
| **轮次触发** | 超过保留轮次自动压缩 |

### 5.7 配置项

```yaml
reasoning:
  preserve_recent_turns: 3      # 保留最近 3 轮的完整 reasoning
  summarize_older: true        # 更早的 reasoning 摘要
  max_reasoning_tokens: 8000   # 单次 reasoning 上限
  compression_trigger:
    - on_compaction
    - on_overflow
    - on_turn_threshold
```
