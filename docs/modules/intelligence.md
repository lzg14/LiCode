# Intelligence 模块

> Licode 的智能决策层：让 AI 行为自适应项目上下文 + 用户偏好 + 工具使用历史。

| 版本 | 日期 | 状态 |
|------|------|------|
| v0.1.0 | 2026-07-05 | 活跃（M2 实现 + M5 集成已落地） |

---

## 一句话定位

Intelligence 模块是一组**可插拔的决策点（Decision Points）**——在 `execute()` 调用前后对 prompt / tool 选择 / 任务深度 / 确认频率做自适应调整。所有决策走同一套 fallback 链，写入 Memory v2 用于长期偏好学习。

---

## 模块组成

```
packages/core/intelligence/
├── types.ts            # 类型定义（AugmentedPrompt / DecisionContext / ...）
├── registry.ts         # DecisionRegistry：name → handler 映射
├── fallback.ts         # FallbackPolicy：链式 fallback（verbosity → tool-choice → task-depth → confirm-frequency → none）
├── recorder.ts         # IntelligenceRecorder：把 decision 事件 + tool call 事件写入 Memory v2
├── adapter.ts          # IntelligenceAdapter：对外入口，beforeExecute / afterExecute 钩子
├── index.ts            # 模块出口
├── decisions/
│   ├── verbosity.ts        # verbosityDecision：基于项目偏好选 response 详细度
│   ├── tool-choice.ts      # toolChoiceDecision：基于历史 tool-stats 选工具
│   ├── task-depth.ts       # taskDepthDecision：基于任务复杂度选 plan 深度
│   └── confirm-frequency.ts# confirmFrequencyDecision：基于用户拒绝历史调确认频率
└── __tests__/
    ├── recorder.test.ts    # 4 用例
    ├── fallback.test.ts   # 3 用例
    ├── registry.test.ts   # 2 用例
    ├── adapter.test.ts    # 4 用例
    └── decisions/         # 4 个 decision 各 2-3 用例
```

---

## 核心接口

### `IntelligenceAdapter`

```typescript
const adapter = new IntelligenceAdapter({ registry: defaultRegistry() })

// execute 前：augment prompt + 决策记录
const augmented = await adapter.beforeExecute({ prompt, ctx, memory, modelInfo })
// ↑ 返回 { prompt, decisions: DecisionResult[] }

// execute 后：记录 tool call 事件
await adapter.afterExecute({ toolCalls, ctx, memory, modelInfo })
```

### `DecisionHandler`

每个 decision 是一个 `(ctx: IntelligenceContext) => DecisionResult | null` 函数：
- 返回非 null → 使用此结果
- 返回 null → registry 走 fallback 链

### `FallbackPolicy`

```
verbosity → tool-choice → task-depth → confirm-frequency → none
```

链上任一返回非 null 即停；全返回 null → 决策未应用（保持默认行为）。

---

## 与 Memory v2 的协作

| 方向 | 来源 | 写入 |
|------|------|------|
| **读** | `memory.entries` 里的 `user-pref` + `tool-stats` | — |
| **写** | — | `decisions/{verbosity,tool-choice,...}/{projectId}.json` + `tool-calls/{projectId}.jsonl` |

详见 [docs/modules/memory.md](./memory.md)。

---

## 设计文档引用

- [docs/plans/intelligence-enhancement-plan.md](../plans/intelligence-enhancement-plan.md) §4.M5 — Intelligence 内核 → CLI 集成 → API 集成节奏
- [docs/plans/hardware-adaptive-architecture-plan.md](../plans/hardware-adaptive-architecture-plan.md) — hardware-aware model fallback（与 verbosityDecision 协作）

---

## 测试覆盖

| 套件 | 用例数 | 覆盖点 |
|------|--------|--------|
| `recorder.test.ts` | 4 | 写 v2 entries / 写 tool-call 事件 / 写盘/读盘往返 / schema 校验 |
| `fallback.test.ts` | 3 | 链 fallback / 全 null → none / 第一个返回非 null 即停 |
| `registry.test.ts` | 2 | name → handler 映射 / 不存在抛错 |
| `adapter.test.ts` | 4 | beforeExecute 返回结构 / afterExecute 写事件 / memory 注入 / modelInfo 透传 |
| `decisions/*` | 11 | 4 个 decision 各 2-3 用例（user-pref 命中 / 未命中 fallback） |
| **合计** | **24** | |

> 注：`adapter.test.ts` 历史上有"并行跑 got 1 expected 2"偶发问题——根因是 `loadFromDir` 加载 v1 `type='memory'` entry 覆盖 v2 entries（已在 `memory.ts` 加 `if (existing?.type !== 'memory') skip` 保护）。

---

## 相关 commit 链

- `092ffe2` M1/M4 spike + eval 框架 + M2 spec
- `691a60c` M2 实现 + Memory store v2 落地
- `dda972b` M5 集成 execute