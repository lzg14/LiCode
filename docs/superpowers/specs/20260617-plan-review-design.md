# 计划审核内嵌设计

**版本**: v1.0.0
**日期**: 2026-06-17

---

## 1. 设计背景

用户认可 superpowers 工作流中的「制定计划 → 审核 → 修改 → 再次审核」机制，希望将其内化到 Pai 的 Core Loop 中。

**核心目标**：
1. 确保 E3+ 任务必须经过审核才能执行
2. 确保工作目录可追溯，防止文件不可恢复

---

## 2. 自动 Git 初始化

### 2.1 机制

**内置行为，无需用户确认。**

```
OBSERVE 阶段
    │
    ├── 检查当前目录是否有 .git
    │
    ├── 有 .git ──→ 继续
    │
    └── 无 .git ──→ 自动 git init（静默）
                       │
                       └── 记录到审计日志
```

### 2.2 行为规则

| 场景 | 行为 |
|------|------|
| 有 .git | 正常继续 |
| 无 .git | 自动 `git init`，静默执行 |
| `git init` 失败 | 警告用户，记录审计，继续执行（不影响功能） |

### 2.3 敏感目录警告

**高风险目录，禁止或警告用户操作。**

```yaml
security:
  sensitive_paths:
    # 高风险：包含大量敏感信息
    - "~"                    # 用户主目录
    - "~\\"                  # Windows 主目录
    - "/home"               # Linux 主目录根
    - "/Users"              # macOS 主目录

    # 中风险：系统配置
    - "/etc"                # 系统配置
    - "/.config"            # 用户配置目录
    - "C:\\Users"           # Windows 用户目录
```

**检测流程**：

```
OBSERVE 阶段
    │
    ├── 获取当前工作目录 (cwd)
    │
    ├── 检查是否命中 sensitive_paths
    │
    ├── 未命中 ──→ 继续
    │
    └── 命中 ──→ 展示警告
               │
               ├── 用户确认继续 ──→ 记录审计，继续执行
               └── 用户拒绝 ──→ 提示切换到项目目录
```

**警告示例**：

```
⚠️  敏感目录警告

当前目录：~
这是一个敏感目录，包含：
- ~/.ssh/ （密钥）
- ~/.aws/ （云凭证）
- ~/.config/ （应用配置）

建议切换到项目目录（如 ~/project/）继续工作。

是否继续在当前目录操作？ [y/N]
```

### 2.4 首次提交约定

```yaml
git:
  auto_init_message: "Initial commit by Pai"
  # 如果用户手动 git commit，使用此消息
```

### 2.3 配置

```yaml
git:
  auto_init: true           # 自动初始化（不可关闭）
  auto_init_message: "Initial commit by Pai"  # 首次提交消息
```

---

## 3. 设计原则

| 原则 | 说明 |
|------|------|
| **分级约束** | E1/E2 跳过审核，E3+ 必须审核 |
| **硬约束** | 审核不通过则阻止执行 |
| **智能收敛** | 相似的审核意见自动收敛 |
| **用户控制** | 用户可强制继续 |

---

## 4. PLAN 阶段子流程（E3+）

```
制定计划
    │
    ▼
触发审核
    │
    ▼
┌─────────────────────────────┐
│     审核结果                 │
└─────────────────────────────┘
        │
 ┌──────┴──────┐
 │             │
 通过         不通过
 │             │
 ▼             ▼
用户确认   修改计划
 │             │
 │         重新审核
 │             │
 │    ┌──────┴──────┐
 │    │             │
 │  收敛?      循环<3次?
 │    │             │
 │  继续         重新审核
 │             │
 └──────┬──────┘
        │
 ┌──────┴──────┐
 │             │
 循环≥3次    用户强制继续
 │             │
 ▼             ▼
提示用户       进入 BUILD
「人工决策」
```

---

## 5. 审核触发条件

| Effort Level | 是否审核 | 说明 |
|--------------|----------|------|
| E1 | 否 | 简单任务，直接执行 |
| E2 | 否 | 简单任务，直接执行 |
| E3 | 是 | 需审核 |
| E4 | 是 | 需审核 |
| E5 | 是 | 需审核 |

---

## 6. 审核实现方式

### 5.1 多 Model 配置

```yaml
models:
  default: claude-haiku-4
  complex: claude-opus-4
  review: claude-sonnet-4

model_routing:
  - pattern: "E3|E4|E5"
    model: "review"  # 审核使用独立的 review model
```

### 5.2 审核调用

| 情况 | 调用方式 |
|------|----------|
| 有多 Model 配置 | 调用另一个 model 审阅 |
| 无多 Model | spawn review 子 agent 审阅 |

**注意**：审核结果展示给用户时可能需要交互（如 Section 8 的选择菜单）。这是 plan-review 模块的职责，不是 review-agent 的职责——review-agent 本身受 BLOCKED_TOOLS 限制禁止用户交互。

### 5.3 子 Agent 限制

```typescript
const REVIEW_AGENT_BLOCKED = [
  'delegate_task',   // 禁止递归
  'clarify',        // 禁止用户交互
  'memory_write',    // 禁止写内存
  'send_message',    // 禁止发消息
  'execute_code',    // 禁止执行
]
```

---

## 7. 终止条件

| 优先级 | 条件 | 行为 |
|--------|------|------|
| 1 | 审核通过 | 用户确认后进入 BUILD |
| 2 | 收敛判断 | 两次相邻审核意见相似度 > 80%，自动继续 |
| 3 | 循环上限 | 3 次审核后提示用户人工决策 |
| 4 | 用户强制 | 用户可随时强制继续 |

### 6.1 迭代定义

**一次迭代 = 审核 → 不通过 → 修改计划 → 再次审核**

```
第 1 次审核 ──不通过──→ 修改 ──→ 第 2 次审核 ──不通过──→ 修改 ──→ 第 3 次审核
                                   ↑
                               收敛判断（第2次 vs 第1次）
```

### 6.2 收敛判断

```typescript
function isConverged(currentIssues: string[], previousIssues: string[]): boolean {
  if (previousIssues.length === 0) return false
  // 只比较相邻两次
  const similarity = calculateSimilarity(currentIssues, previousIssues)
  return similarity >= 0.8  // 80% 相似度阈值
}

// 第 3 次不通过时：如果与第 2 次相似 → 收敛 → 强制继续
//                 如果与第 2 次不相似但循环已达上限 → 提示用户人工决策
```

### 6.3 收敛后的行为

收敛判断成立后：
1. 将剩余问题记录到 plan 文档的 `pending_issues`
2. 提示用户：「审核意见已收敛，存在以下未解决问题，是否继续？」
3. 用户确认后才进入 BUILD

### 6.4 超时/失败处理

```typescript
async function triggerReview(plan: Plan): Promise<ReviewResult> {
  try {
    return await reviewModel.generate(plan)
  } catch (error) {
    // 审核失败时，重试 1 次
    await delay(1000)
    return await reviewModel.generate(plan)
  }
  // 再次失败则标记审核异常，继续执行但记录警告
  return { status: 'error', issues: [], warning: 'Review failed' }
}
```

---

## 8. 配置

```yaml
review:
  # 触发阈值，E3+ 才审核
  effort_threshold: 3

  # 审核循环上限
  max_iterations: 3

  # 收敛相似度阈值
  convergence_threshold: 0.8

  # 是否允许用户强制继续
  allow_force_continue: true
```

---

## 9. 审核结果展示

```
【审核结果】

问题 1: [高] 缺少错误处理
建议: 在 build 阶段添加 try-catch

问题 2: [中] 配置硬编码
建议: 改为环境变量

问题 3: [低] 缺少单元测试
建议: 添加测试用例

---
是否进入执行阶段？
1. 修改后重新审核 ──→ 修改 plan 内容，重新触发审核
2. 强制继续执行 ──→ 记录 pending_issues，继续 BUILD
3. 取消 ──→ 终止任务
```

---

## 10. 与其他机制的关系

| 机制 | 关系 |
|------|------|
| **grill-me Interview** | THINK 阶段在前，发现问题并澄清；问题记录到 context，PLAN 阶段审核计划时可见 |
| **Anti-criteria** | THINK 阶段展示弊端，PLAN 阶段审核计划是否考虑了这些弊端 |
| **Review Agent** | VERIFY 阶段的反方评审是执行后的验证，与 PLAN 审核是不同的环节 |
| **多 Agent 协调** | 审核使用子 Agent，但受 BLOCKED_TOOLS 限制 |

### 9.1 问题传递

THINK 阶段发现的问题 → 记录到 LoopContext.pendingIssues → PLAN 阶段可见 → 审核时一并检查

---

## 11. 实现位置

```
packages/core/phases/
├── plan.ts              # PLAN 阶段主逻辑，顺序调用
├── plan-review.ts       # 审核子逻辑，负责展示、交互、终止判断
└── review-agent.ts     # 审核 Agent 定义（用于 spawn）
```

### 10.1 plan.ts 职责

```typescript
async function plan(ctx: LoopContext): Promise<Partial<LoopContext>> {
  // 1. 制定计划
  const plan = await generatePlan(ctx)

  // 2. 触发审核（如果是 E3+）
  if (ctx.effortLevel >= config.review.effortThreshold) {
    const reviewResult = await planReview(ctx, plan)
    if (reviewResult.status === 'blocked') {
      return { phase: 'PLAN', pendingReview: reviewResult }
    }
  }

  // 3. 进入 BUILD
  return { phase: 'BUILD', plan }
}
```

### 10.2 plan-review.ts 职责

```typescript
async function planReview(ctx: LoopContext, plan: Plan): Promise<ReviewResult> {
  let iteration = 0
  let previousIssues: string[] = []

  while (iteration < config.review.maxIterations) {
    const result = await triggerReview(plan)

    if (result.approved) {
      return await askUserConfirmation(result)
    }

    // 不通过，尝试收敛判断
    if (isConverged(result.issues, previousIssues)) {
      return await forceContinueWithPendingIssues(result.issues)
    }

    previousIssues = result.issues
    iteration++

    // 修改计划后重新审核
    plan = await modifyPlanBasedOnIssues(plan, result.issues)
  }

  return { status: 'blocked', issues: previousIssues, message: '请人工决策' }
}
```
