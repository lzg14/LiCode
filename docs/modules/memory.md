# 记忆系统设计

**版本**: v1.0.0
**日期**: 2026-06-17
**参考**: mimo-code, opencode

---

## 1. 三层记忆

| 层级 | 容量 | 生命周期 | 存储方式 |
|------|------|---------|----------|
| **短期记忆** | 最近 10 次交互 | Session | 内存 |
| **中期记忆** | 当前项目上下文 | 项目周期 | SQLite |
| **长期记忆** | 永久知识 | 永久 | Markdown + 向量索引 |

---

## 2. Scope 和 Type（参考 mimo-code）

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

---

## 3. 存储架构

```
Memory System (mimo-code 风格)
├── SQLite FTS5  → 全文索引 + BM25 搜索
├── Markdown     → 磁盘文件（与 DB 双向同步）
└── 指纹缓存     → 避免重复索引
```

---

## 4. AI 主动管理机制

- 每次交互后，AI 判断哪些信息值得升级到中期/长期记忆
- 长期记忆自动过期机制（30天未访问自动归档）
- 记忆压缩：相似记忆自动合并

---

## 5. Memory Recall（参考 mimo-code）

### 5.1 时机

每次 loop 执行时，在生成 prompt 前检查 session 是否有 memory。

### 5.2 机制

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

### 5.3 设计思路

- **主动 recall** 而非被动注入（类似神经科学的 active recall 原理）
- 降低 token 消耗（只有需要时才查）
- 保持 agent 的自主性（agent 自己决定是否调用 memory.search）

### 5.4 触发条件

- session 有 memory 目录或 tasks 记录
- 每次 prompt 生成时检查

### 5.5 相关配置

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `memory_reconcile_on_search` | true | 搜索前是否 reconcile |
| `memory_search_score_floor` | 0.15 | BM25 评分地板（过滤噪音） |

---

## 6. 目录结构

```
~/.pai/
├── memory/
│   ├── global/           # 全局记忆
│   ├── projects/         # 项目记忆
│   │   └── <project-id>/
│   │       ├── memory.md
│   │       ├── notes.md
│   │       └── feedback.md
│   └── sessions/         # 会话记忆
│       └── <session-id>/
│           └── memory.md
├── skills/               # 已安装技能
├── cache/                # 缓存
├── logs/                 # 日志
└── data/
    └── memory.db         # SQLite FTS5
```

---

## 7. 索引策略

| 索引类型 | 用途 |
|----------|------|
| BM25 | 全文搜索 |
| 向量索引 | 语义搜索 |
| 指纹缓存 | 去重 |
| 时间索引 | 时效性查询 |

---

## 8. 与 opencode Session 的关系

opencode 的 Session 历史记录在 Session 层管理，不属于 Memory 系统。

Memory 系统负责：
- 跨 Session 的持久化记忆
- 项目级别的上下文
- 用户明确要求的记忆

Session 历史由 Session 层通过 Checkpoint 机制管理。
