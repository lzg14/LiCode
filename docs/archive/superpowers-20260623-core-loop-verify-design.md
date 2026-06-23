# Core Loop VERIFY 阶段设计

> **状态**：草稿

## 背景与目标

当前 licode Core Loop 只有 `EXECUTE → DONE`，没有验证环节。LLM 执行完工具调用后直接结束，无法保障交付物确实正确。

本设计在 EXECUTE 和 DONE 之间增加 VERIFY 阶段，参照 PLAN 阶段承诺的 Deliverables 进行对账检查，实现"说写就写了"的保障。

## 整体架构

```
OBSERVE（可选）→ THINK（可选）→ PLAN → EXECUTE → VERIFY → DONE
```

- OBSERVE / THINK 是可选的：简单任务可直接 PLAN → EXECUTE → VERIFY → DONE
- VERIFY 是必须的：不通过不停 DONE

## 流程定义

### PLAN 阶段

LLM 生成 PLAN 时，同时输出 `Deliverables` 列表：

```
Plan:
1. 创建 src/foo.ts
2. 在 foo.ts 里实现 calculate() 函数
3. 导出 calculate

Deliverables:
- path: src/foo.ts
  check: file_exists
- path: src/foo.ts
  check: contains_function "function calculate"
- path: src/foo.ts
  check: has_export "calculate"
```

LLM 自行决定哪些步骤需要 Deliverables 保障，原则：
- 文件级别变更（新增/修改文件）→ 必须 `file_exists`
- 关键内容（必须有的函数/类）→ 加 `contains_pattern` 或 `has_export`
- 纯查询步骤 → 可无 Deliverables

### EXECUTE 阶段

LLM 调用工具执行 PLAN 中的步骤。工具调用失败时：
- 重试 EXECUTE，最多 2 次
- 2 次后仍失败 → 报告错误，停在 EXECUTE

### VERIFY 阶段

对照 Deliverables 逐项检查：

| check 类型 | 实现方式 |
|-----------|---------|
| `file_exists` | `fs.existsSync(path)` |
| `contains_pattern` | 读取文件，正则匹配 |
| `has_export` | 读取文件，检查 export 语句 |
| `has_import` | 读取文件，检查无指定 import |
| `has_no_error` | `tsc --noEmit` 检查无语法错误 |
| `glob_match` | Glob 匹配文件列表 |

所有检查通过 → DONE
有任何一项不通过 → 报告失败项及原因，停在 VERIFY

### DONE 阶段

- VERIFY 全部通过 → 写入 memory（关键决策/结论），会话结束
- VERIFY 失败 → 等待用户确认（重试 / 调整 / 中止）

## 数据类型

```typescript
// packages/core/types.ts

interface Deliverable {
  path?: string           // 文件路径（与 glob 二选一）
  glob?: string          // Glob 模式
  check: CheckType        // 检查类型
  value?: string         // 检查的值（如正则、函数名）
}

type CheckType =
  | 'file_exists'
  | 'contains_pattern'
  | 'has_export'
  | 'has_no_import'
  | 'has_no_error'
  | 'glob_match'

interface Plan {
  steps: string[]
  deliverables?: Deliverable[]
}
```

## 错误处理

| 场景 | 处理 |
|------|------|
| EXECUTE 工具调用失败 | 重试（最多2次）→ 仍失败则报告 |
| EXECUTE 没有任何文件产出 | 报告"无交付物"，停在 VERIFY |
| VERIFY 某项不通过 | 报告失败项及原因，停在 VERIFY，不自动修复 |
| VERIFY 全部通过 | 写入 memory，DONE |

**原则**：VERIFY 失败时不自动重试 EXECUTE，避免无限循环。

## 实现计划

### Phase 1: 基础框架
- [ ] `packages/core/types.ts` — 增加 `Deliverable`、`CheckType`、`Plan.deliverables` 类型
- [ ] `packages/core/verify.ts` — 新建，实现 `verifyDeliverables()` 函数
- [ ] `packages/core/loop.ts` — 增加 VERIFY phase 入口，调用 verifyDeliverables

### Phase 2: LLM 输出 Deliverables
- [ ] 调整 system prompt，引导 LLM 在 PLAN 中输出 Deliverables
- [ ] 解析 LLM 输出中的 Deliverables 列表

### Phase 3: 与现有系统集成
- [ ] `packages/core/plan.ts` — 改造，支持 Deliverables 输出
- [ ] `packages/tui/` — 在 TUI 里展示 VERIFY 结果（通过/失败状态）

## 示例

**用户输入**：帮我把 getUser 函数改名为 getCurrentUser

**PLAN 输出**：
```
Plan:
1. 找到所有引用 getUser 的文件
2. 将函数定义重命名为 getCurrentUser
3. 将所有调用处一并重命名

Deliverables:
- path: src/user.ts
  check: contains_pattern
  value: "function getCurrentUser"
- glob: "**/*.ts"
  check: has_no_import
  value: "getUser"
- path: src/user.ts
  check: has_no_error
```

**VERIFY 通过**：
```
✓ src/user.ts 包含 function getCurrentUser
✓ 无任何 .ts 文件 import getUser
✓ tsc --noEmit 无错误
→ DONE，写入 memory
```

**VERIFY 失败**：
```
✗ src/user.ts 不包含 function getCurrentUser
  实际内容：function getUser { ... }
停在 VERIFY，等待用户确认。
```
