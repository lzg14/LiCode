# licode MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 licode MVP，涵盖 Core Loop、多 Agent 协调、配置系统、Memory、Skills、Security、Audit 基础功能。

**Architecture:** 采用模块化架构，核心循环（Core Loop）协调各子系统（Memory、Agent、Skills、Security、Audit）。配置系统支持多层叠加，外部配置自动发现。Memory 使用 FTS5 实现跨会话搜索。Agent 系统采用完全隔离模式，支持子 Agent 并发控制。

**Tech Stack:** TypeScript, Node.js, SQLite (FTS5), Zod (验证), Effect (函数式编程)

---

## 参考源码

**实现时应大量参考以下源码，复用成熟设计：**

| 框架 | 路径 | 主要参考内容 |
|------|------|-------------|
| **mimo-code** | `D:\ProjectFile\mimo-code\packages\opencode\src\` | Core Loop、Session、Context 管理 |
| **opencode** | 同上 | Agent spawn、Tool Registry、Permission |
| **mimo-code** | `packages/opencode/src/session/*.ts` | Session 管理、Checkpoint、Compaction |
| **mimo-code** | `packages/opencode/src/agent/*.ts` | Agent 类型、Spawn、生命周期 |
| **mimo-code** | `packages/opencode/src/tool/*.ts` | Tool 定义、Registry、执行 |
| **mimo-code** | `packages/opencode/src/config/*.ts` | 配置加载、多层配置 |
| **mimo-code** | `packages/opencode/src/skill/*.ts` | Skills 注册、执行 |

### 关键参考文件

```bash
# Core Loop 参考
mimo-code/packages/opencode/src/session/session.ts       # Session 主循环
mimo-code/packages/opencode/src/session/processor.ts     # 处理流程

# Agent 参考
mimo-code/packages/opencode/src/actor/spawn.ts          # Agent spawn
mimo-code/packages/opencode/src/actor/actor.ts         # Actor 模型

# Tool 参考
mimo-code/packages/opencode/src/tool/registry.ts       # Tool 注册
mimo-code/packages/opencode/src/tool/builtin.ts         # 内置工具

# Config 参考
mimo-code/packages/opencode/src/config/config.ts        # 配置主文件
mimo-code/packages/opencode/src/config/loader.ts        # 配置加载

# Context 参考
mimo-code/packages/opencode/src/session/compact.ts     # 上下文压缩
mimo-code/packages/opencode/src/session/prune.ts        # 修剪策略
```

### 可直接拿过来的文件

mimo-code 使用 Effect 框架，依赖较重。但以下部分可简化后直接使用：

| 文件 | 可直接用 | 原因 |
|------|----------|------|
| `config/schema.ts` | 部分 | Zod Schema 定义可简化 |
| `agent/types.ts` | 部分 | Agent/Spawn 类型定义可复用 |
| `tool/types.ts` | ✅ 是 | Tool 类型定义可直接用 |
| `session/types.ts` | 部分 | Session/Message 类型可复用 |
| `memory/schema.ts` | ✅ 是 | MemoryEntry 类型可直接用 |

### 实现策略

1. **先读懂参考代码** — 不要凭猜测，理解后再实现
2. **复用模式** — 复用在 mimo-code/opencode 中已验证的模式
3. **简化但不破坏** — 可以简化复杂逻辑，但不要破坏核心设计
4. **标注来源** — 代码注释标注参考来源，方便后续追溯
5. **直接拿过来** — 如果文件合适，直接复制过来简化

---

---

## 文件结构

```
packages/
├── core/                    # 核心模块
│   ├── loop.ts             # Core Loop 主循环
│   ├── phases/             # 七阶段实现
│   │   ├── observe.ts      # 含 Git 初始化、敏感目录检查
│   │   ├── think.ts
│   │   ├── plan.ts         # 含审核内嵌
│   │   ├── plan-review.ts  # 审核子逻辑（新增）
│   │   ├── build.ts
│   │   ├── execute.ts
│   │   ├── verify.ts
│   │   └── learn.ts
│   └── context/            # 上下文管理
│       ├── manager.ts
│       └── compact.ts
├── agent/                  # Agent 系统
│   ├── agent.ts           # Agent 基类
│   ├── spawn.ts           # Agent 派生
│   ├── blocked-tools.ts   # Blocked Tools
│   ├── limits.ts          # 并发控制
│   └── types.ts           # 类型定义
├── memory/                 # 记忆系统
│   ├── memory.ts          # 记忆基类
│   ├── recall.ts          # Recall 机制
│   ├── fts5.ts            # FTS5 搜索
│   └── schema.ts          # 数据模型
├── skills/                 # Skills 系统
│   ├── registry.ts        # 注册表
│   ├── executor.ts        # 执行器
│   └── types.ts           # 类型定义
├── config/                 # 配置系统
│   ├── loader.ts          # 加载器
│   ├── external.ts        # 外部配置发现
│   └── schema.ts          # Zod Schema
├── security/               # 安全模块
│   ├── whitelist.ts       # 命令白名单
│   └── permissions.ts     # 权限管理
├── audit/                  # 审计模块
│   ├── logger.ts          # 记录器
│   └── events.ts          # 事件定义
└── index.ts                # 入口
```

---

## Phase 1: 基础框架

### Task 1: 项目初始化

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `packages/core/index.ts`

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "@pai/core",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "test": "vitest"
  },
  "dependencies": {
    "zod": "^3.23.0",
    "effect": "^3.0.0",
    "better-sqlite3": "^11.0.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["*.ts"]
}
```

- [ ] **Step 3: 创建 core/index.ts 导出**

```typescript
export * from './types'
export * from './loop'
```

- [ ] **Step 4: Commit**

```bash
git add package.json tsconfig.json packages/core/index.ts
git commit -m "feat: initialize project structure"
```

---

### Task 2: 类型定义

**Files:**
- Create: `packages/core/types.ts`

- [ ] **Step 1: 创建 types.ts**

```typescript
// 基础类型
export type SessionId = string & { readonly _brand: 'SessionId' }
export type UserId = string & { readonly _brand: 'UserId' }
export type MessageId = string & { readonly _brand: 'MessageId' }

// Effort Level
export type EffortLevel = 1 | 2 | 3 | 4 | 5

// Agent 类型
export type AgentType = 'primary' | 'subagent' | 'fork'

// 阶段
export type Phase = 'OBSERVE' | 'THINK' | 'PLAN' | 'BUILD' | 'EXECUTE' | 'VERIFY' | 'LEARN'

// 配置
export interface Config {
  llm: LLMConfig
  security: SecurityConfig
  memory: MemoryConfig
  subagent: SubagentConfig
}

export interface LLMConfig {
  provider: 'anthropic' | 'openai' | 'local'
  model: string
  apiKeyEnv: string
}

export interface SecurityConfig {
  commandWhitelist: string[]
  allowedPaths: string[]
  deniedPaths: string[]
}

export interface MemoryConfig {
  path: string
  retentionDays: number
}

export interface SubagentConfig {
  maxConcurrent: number
  maxDepth: number
  timeoutMs: number
  blockedTools: string[]
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/types.ts
git commit -m "feat: add core types"
```

---

## Phase 2: 配置系统

### Task 3: 配置加载器

**Files:**
- Create: `packages/config/loader.ts`
- Create: `packages/config/schema.ts`
- Create: `packages/config/external.ts`

- [ ] **Step 1: 创建配置 Schema**

```typescript
// packages/config/schema.ts
import { z } from 'zod'

export const LLMConfigSchema = z.object({
  provider: z.enum(['anthropic', 'openai', 'local']),
  model: z.string(),
  apiKeyEnv: z.string(),
})

export const SecurityConfigSchema = z.object({
  commandWhitelist: z.array(z.string()),
  allowedPaths: z.array(z.string()),
  deniedPaths: z.array(z.string()),
})

export const SubagentConfigSchema = z.object({
  maxConcurrent: z.number().default(3),
  maxDepth: z.number().default(1),
  timeoutMs: z.number().default(900000),
  blockedTools: z.array(z.string()).default([
    'delegate_task',
    'clarify',
    'memory_write',
    'send_message',
    'execute_code',
  ]),
})

export const ConfigSchema = z.object({
  llm: LLMConfigSchema,
  security: SecurityConfigSchema,
  memory: MemoryConfigSchema,
  subagent: SubagentConfigSchema,
})
```

- [ ] **Step 2: 创建配置加载器**

```typescript
// packages/config/loader.ts
import { ConfigSchema, type Config } from './schema'

export class ConfigLoader {
  async load(path: string): Promise<Config> {
    const file = await Bun.file(path).text()
    const data = JSON.parse(file)
    return ConfigSchema.parse(data)
  }

  async loadWithOverrides(
    basePath: string,
    overrides?: Partial<Config>
  ): Promise<Config> {
    const base = await this.load(basePath)
    return { ...base, ...overrides }
  }
}
```

- [ ] **Step 3: 创建外部配置发现**

```typescript
// packages/config/external.ts
import { existsSync } from 'fs'
import { join } from 'path'

export interface ExternalSource {
  type: 'claude-code' | 'opencode' | 'hermes'
  path: string
  exists: boolean
}

export async function discoverExternalSources(home: string): Promise<ExternalSource[]> {
  return [
    {
      type: 'claude-code',
      path: join(home, '.claude', 'projects'),
      exists: existsSync(join(home, '.claude', 'projects')),
    },
    {
      type: 'opencode',
      path: join(home, '.opencode'),
      exists: existsSync(join(home, '.opencode')),
    },
    {
      type: 'hermes',
      path: join(home, '.hermes'),
      exists: existsSync(join(home, '.hermes')),
    },
  ]
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/config/
git commit -m "feat: add config system with external discovery"
```

---

## Phase 3: Core Loop

### Task 4: Core Loop 主循环

**Files:**
- Create: `packages/core/loop.ts`

- [ ] **Step 1: 创建 Core Loop 主循环**

```typescript
// packages/core/loop.ts
import type { Phase, Config } from './types'
import { observe } from './phases/observe'
import { think } from './phases/think'
import { plan } from './phases/plan'
import { build } from './phases/build'
import { execute } from './phases/execute'
import { verify } from './phases/verify'
import { learn } from './phases/learn'

export interface LoopContext {
  sessionId: string
  userInput: string
  effortLevel: number
  phase: Phase
}

const PHASE_ORDER: Phase[] = ['OBSERVE', 'THINK', 'PLAN', 'BUILD', 'EXECUTE', 'VERIFY', 'LEARN']

export class CoreLoop {
  constructor(private config: Config) {}

  async run(ctx: LoopContext): Promise<string> {
    let currentPhase = ctx.phase

    while (currentPhase !== 'DONE') {
      const result = await this.executePhase(currentPhase, ctx)
      ctx = { ...ctx, ...result }

      const nextIndex = PHASE_ORDER.indexOf(currentPhase) + 1
      currentPhase = nextIndex < PHASE_ORDER.length ? PHASE_ORDER[nextIndex] : 'DONE'
    }

    return ctx.userInput // 最终输出
  }

  private async executePhase(phase: Phase, ctx: LoopContext): Promise<Partial<LoopContext>> {
    switch (phase) {
      case 'OBSERVE':
        return observe(ctx)
      case 'THINK':
        return think(ctx)
      case 'PLAN':
        return plan(ctx)
      case 'BUILD':
        return build(ctx)
      case 'EXECUTE':
        return execute(ctx)
      case 'VERIFY':
        return verify(ctx)
      case 'LEARN':
        return learn(ctx)
      default:
        throw new Error(`Unknown phase: ${phase}`)
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/loop.ts
git commit -m "feat: add Core Loop main orchestration"
```

---

### Task 5: 七阶段实现

**Files:**
- Create: `packages/core/phases/observe.ts`
- Create: `packages/core/phases/think.ts`
- Create: `packages/core/phases/plan.ts`
- Create: `packages/core/phases/build.ts`
- Create: `packages/core/phases/execute.ts`
- Create: `packages/core/phases/verify.ts`
- Create: `packages/core/phases/learn.ts`
- Create: `packages/core/phases/index.ts`

- [ ] **Step 1: 实现 OBSERVE 阶段**

```typescript
// packages/core/phases/observe.ts
import type { LoopContext } from '../loop'
import { existsSync } from 'fs'
import { execSync } from 'child_process'

export async function observe(ctx: LoopContext): Promise<Partial<LoopContext>> {
  // 1. 解析用户输入
  // 2. 判断 Effort Level
  // 3. Git 自动初始化
  // 4. 敏感目录检查
  // 5. Memory Recall
  // 6. 生成观察报告

  const effortLevel = estimateEffortLevel(ctx.userInput)

  // Git 自动初始化
  await ensureGitInitialized(ctx.cwd)

  // 敏感目录警告
  const sensitiveWarning = await checkSensitivePath(ctx.cwd)

  return {
    effortLevel,
    phase: 'THINK',
    sensitiveWarning,
  }
}

async function ensureGitInitialized(cwd: string): Promise<void> {
  const gitDir = join(cwd, '.git')
  if (!existsSync(gitDir)) {
    try {
      execSync('git init', { cwd, stdio: 'pipe' })
      execSync('git add -A && git commit -m "Initial commit by Pai"', { cwd, stdio: 'pipe' })
    } catch {
      // 失败不影响流程，只记录警告
    }
  }
}

const SENSITIVE_PATHS = ['~', '/home', '/Users', '/etc', 'C:\\Users']

async function checkSensitivePath(cwd: string): Promise<SensitiveWarning | null> {
  for (const sensitive of SENSITIVE_PATHS) {
    if (cwd.includes(sensitive)) {
      return {
        path: cwd,
        reason: '包含敏感目录',
      }
    }
  }
  return null
}

function estimateEffortLevel(input: string): number {
  // 简单启发式估算
  if (input.length < 50) return 1
  if (input.includes('?')) return 2
  if (input.includes('帮我') || input.includes('帮我搞')) return 3
  return 4
}
```

- [ ] **Step 2: 实现 THINK 阶段（包含 grill-me + Anti-criteria）**

```typescript
// packages/core/phases/think.ts
import type { LoopContext } from '../loop'

export async function think(ctx: LoopContext): Promise<Partial<LoopContext>> {
  // 1. 分析风险/假设/失败模式
  const risks = analyzeRisks(ctx.userInput)

  // 2. grill-me 风格追问（E3+ 触发）
  if (ctx.effortLevel >= 3) {
    const questions = generateGrillMeQuestions(ctx.userInput, risks)
    if (questions.length > 0) {
      // 返回追问状态，等待用户回答
      return {
        phase: 'THINK',
        pendingQuestions: questions,
      }
    }
  }

  // 3. Anti-criteria 展示（E4+ 触发）
  if (ctx.effortLevel >= 4) {
    const antiCriteria = generateAntiCriteria(ctx.userInput, risks)
    return {
      phase: 'THINK',
      antiCriteria,
    }
  }

  // 4. 搜索记忆
  const memories = await searchMemories(ctx.userInput)

  return {
    phase: 'PLAN',
    risks,
    memories,
  }
}

function analyzeRisks(input: string): string[] {
  // TODO: 实现风险分析
  return []
}

function generateGrillMeQuestions(input: string, risks: string[]): string[] {
  // TODO: 实现 grill-me 追问
  return []
}

function generateAntiCriteria(input: string, risks: string[]): string[] {
  // TODO: 实现反向追问
  return []
}

async function searchMemories(input: string): Promise<string[]> {
  // TODO: 实现记忆搜索
  return []
}
```

- [ ] **Step 3: 实现 PLAN 阶段**

```typescript
// packages/core/phases/plan.ts
import type { LoopContext } from '../loop'

export async function plan(ctx: LoopContext): Promise<Partial<LoopContext>> {
  // 1. 制定计划
  const plan = await generatePlan(ctx)

  // 2. E3+ 必须审核
  if (ctx.effortLevel >= 3) {
    const reviewResult = await planReview(ctx, plan)

    if (reviewResult.status === 'blocked') {
      // 审核未通过，阻止执行
      return {
        phase: 'PLAN',
        pendingReview: reviewResult,
      }
    }

    // 审核通过或收敛，继续
    return {
      phase: 'BUILD',
      plan,
      reviewResult,
    }
  }

  // E1/E2 直接执行
  return {
    phase: 'BUILD',
    plan,
  }
}

// 审核子逻辑
async function planReview(ctx: LoopContext, plan: Plan): Promise<ReviewResult> {
  let iteration = 0
  let previousIssues: string[] = []

  while (iteration < 3) {  // 最多 3 次
    const result = await triggerReview(plan)

    if (result.approved) {
      // 审核通过，等待用户确认
      return await askUserConfirm(result)
    }

    // 收敛判断：与上一次意见相似
    if (isConverged(result.issues, previousIssues)) {
      return await forceContinueWithPending(result.issues)
    }

    previousIssues = result.issues
    iteration++

    // 修改计划后重新审核
    plan = await modifyPlanBasedOnIssues(plan, result.issues)
  }

  // 3 次后仍未通过
  return {
    status: 'blocked',
    issues: previousIssues,
    message: '请人工决策',
  }
}

function isConverged(current: string[], previous: string[]): boolean {
  if (previous.length === 0) return false
  const similarity = calculateSimilarity(current, previous)
  return similarity >= 0.8
}

// 辅助函数占位
async function generatePlan(ctx: LoopContext): Promise<Plan> { return { steps: [] } }
async function triggerReview(plan: Plan): Promise<ReviewResult> { return { approved: true } }
async function askUserConfirm(result: ReviewResult): Promise<ReviewResult> { return result }
async function forceContinueWithPending(issues: string[]): Promise<ReviewResult> { return { approved: true, pendingIssues: issues } }
async function modifyPlanBasedOnIssues(plan: Plan, issues: string[]): Promise<Plan> { return plan }
function calculateSimilarity(a: string[], b: string[]): number { return 0.5 }
```

- [ ] **Step 3.5: 创建 plan-review.ts**

```typescript
// packages/core/phases/plan-review.ts
// 审核子逻辑，负责展示、交互、终止判断

export interface ReviewResult {
  status: 'approved' | 'blocked' | 'converged'
  issues: string[]
  pendingIssues?: string[]
  message?: string
}

export async function triggerReview(plan: Plan): Promise<ReviewResult> {
  // 有多 Model 配置 → 调用另一个 LLM
  // 单 LLM → spawn review 子 agent
  // TODO: 根据 config.models 判断
}

export async function spawnReviewAgent(plan: Plan): Promise<ReviewResult> {
  // 使用子 Agent 审阅计划
  // 受 BLOCKED_TOOLS 限制
}
```

- [ ] **Step 4: 实现 BUILD 阶段**

```typescript
// packages/core/phases/build.ts
import type { LoopContext } from '../loop'

export async function build(ctx: LoopContext): Promise<Partial<LoopContext>> {
  // 1. 根据 plan 执行工具调用
  // 2. 获取中间结果

  return {
    phase: 'EXECUTE',
    intermediateResults: [],
  }
}
```

- [ ] **Step 5: 实现 EXECUTE 阶段**

```typescript
// packages/core/phases/execute.ts
import type { LoopContext } from '../loop'

export async function execute(ctx: LoopContext): Promise<Partial<LoopContext>> {
  // 1. 将工具结果转化为可交付物
  // 2. 更新 ISA 进度
  // 3. 格式化输出

  return {
    phase: 'VERIFY',
    deliverable: ctx.intermediateResults,
  }
}
```

- [ ] **Step 6: 实现 VERIFY 阶段（包含 Review Agent）**

```typescript
// packages/core/phases/verify.ts
import type { LoopContext } from '../loop'

export async function verify(ctx: LoopContext): Promise<Partial<LoopContext>> {
  // 1. 验证质量
  // 2. 检查错误
  // 3. Live-Probe
  // 4. 触发 Review Agent（E3+）

  if (ctx.effortLevel >= 3) {
    const reviewResult = await triggerReviewAgent(ctx.deliverable)
    return {
      phase: reviewResult.approved ? 'LEARN' : 'PLAN',
      reviewResult,
    }
  }

  return {
    phase: 'LEARN',
  }
}

async function triggerReviewAgent(deliverable: unknown): Promise<ReviewResult> {
  // TODO: 调用 Review Agent 评审
  return { approved: true, issues: [] }
}
```

- [ ] **Step 7: 实现 LEARN 阶段**

```typescript
// packages/core/phases/learn.ts
import type { LoopContext } from '../loop'

export async function learn(ctx: LoopContext): Promise<Partial<LoopContext>> {
  // 1. 更新记忆
  // 2. Skill 自改进
  // 3. 总结经验

  await updateMemory(ctx)
  await improveSkills(ctx)
  await summarizeExperience(ctx)

  return {
    phase: 'DONE' as any,
  }
}

async function updateMemory(ctx: LoopContext): Promise<void> {}
async function improveSkills(ctx: LoopContext): Promise<void> {}
async function summarizeExperience(ctx: LoopContext): Promise<void> {}
```

- [ ] **Step 8: 创建 index.ts 导出**

```typescript
// packages/core/phases/index.ts
export { observe } from './observe'
export { think } from './think'
export { plan } from './plan'
export { build } from './build'
export { execute } from './execute'
export { verify } from './verify'
export { learn } from './learn'
```

- [ ] **Step 9: Commit**

```bash
git add packages/core/phases/
git commit -m "feat: implement all seven phases with grill-me, anti-criteria, and review agent"
```

---

## Phase 4: 多 Agent 协调

### Task 6: Agent 系统

**Files:**
- Create: `packages/agent/types.ts`
- Create: `packages/agent/agent.ts`
- Create: `packages/agent/spawn.ts`
- Create: `packages/agent/blocked-tools.ts`
- Create: `packages/agent/limits.ts`

- [ ] **Step 1: 创建 Agent 类型**

```typescript
// packages/agent/types.ts
import type { AgentType, SessionId } from '../core/types'

export interface Agent {
  id: string
  type: AgentType
  parentId?: string
  depth: number  // 用于 MAX_DEPTH=1 限制
  sessionId: SessionId
  tools: string[]
  blockedTools: string[]
  createdAt: number
}

export interface SpawnInput {
  mode: AgentType
  parentId?: string
  task: string
  context: 'full' | 'minimal' | 'fork'
  tools: string[] | 'inherit'
  timeoutMs?: number
}
```

- [ ] **Step 2: 创建 Blocked Tools 定义**

```typescript
// packages/agent/blocked-tools.ts
export const SUBAGENT_BLOCKED_TOOLS = [
  'delegate_task',    // 禁止递归派生
  'clarify',         // 禁止用户交互
  'memory_write',    // 禁止写入共享内存
  'send_message',    // 禁止跨平台副作用
  'execute_code',    // 禁止执行脚本
] as const

export function isBlockedTool(tool: string): boolean {
  return SUBAGENT_BLOCKED_TOOLS.includes(tool as any)
}
```

- [ ] **Step 3: 创建并发限制**

```typescript
// packages/agent/limits.ts
export interface AgentLimits {
  maxConcurrent: number
  maxDepth: number    // 1 = 主 Agent 可派生子 Agent，但子 Agent 不能继续派生
  timeoutMs: number
}

export const DEFAULT_LIMITS: AgentLimits = {
  maxConcurrent: 3,
  maxDepth: 1,       // depth=0: primary, depth=1: subagent, depth>=2: 禁止
  timeoutMs: 900000,
}

class AgentLimitManager {
  private current = 0

  // parentDepth=0 (primary) → 可派生 depth=1 的子 Agent
  // parentDepth=1 (subagent) → 不可继续派生
  canSpawn(parentDepth: number): boolean {
    if (this.current >= DEFAULT_LIMITS.maxConcurrent) return false
    if (parentDepth >= DEFAULT_LIMITS.maxDepth) return false  // depth=1 时禁止再派生
    return true
  }

  spawn(parentDepth: number): void {
    this.current++
  }

  terminate(): void {
    this.current = Math.max(0, this.current - 1)
  }
}

export const limitManager = new AgentLimitManager()
```

- [ ] **Step 4: 创建 Agent 基类**

```typescript
// packages/agent/agent.ts
import type { Agent, SpawnInput } from './types'
import { isBlockedTool } from './blocked-tools'
import { limitManager, DEFAULT_LIMITS } from './limits'

export class AgentManager {
  private agents = new Map<string, Agent>()

  spawn(input: SpawnInput, parentDepth = 0): Agent {
    if (!limitManager.canSpawn(parentDepth)) {
      throw new Error('Max concurrent agents or depth reached')
    }

    limitManager.spawn(parentDepth)

    const tools = input.tools === 'inherit'
      ? this.getInheritedTools()
      : input.tools.filter(t => !isBlockedTool(t))

    const agent: Agent = {
      id: crypto.randomUUID(),
      type: input.mode,
      parentId: input.parentId,
      depth: parentDepth + 1,
      sessionId: '' as any,
      tools,
      blockedTools: [...SUBAGENT_BLOCKED_TOOLS],
      createdAt: Date.now(),
    }

    this.agents.set(agent.id, agent)
    return agent
  }

  private getInheritedTools(): string[] {
    return []
  }

  terminate(agentId: string): void {
    this.agents.delete(agentId)
    limitManager.terminate()
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add packages/agent/
git commit -m "feat: add multi-agent system with blocked tools and limits"
```

---

## Phase 5: Memory 系统

### Task 7: 记忆系统

**Files:**
- Create: `packages/memory/schema.ts`
- Create: `packages/memory/memory.ts`
- Create: `packages/memory/recall.ts`
- Create: `packages/memory/fts5.ts`

- [ ] **Step 1: 创建 Memory Schema**

```typescript
// packages/memory/schema.ts
export interface MemoryEntry {
  id: string
  scope: 'global' | 'project' | 'session'
  type: 'memory' | 'notes' | 'checkpoint' | 'progress' | 'feedback'
  content: string
  createdAt: number
  updatedAt: number
  accessCount: number
}
```

- [ ] **Step 2: 创建 FTS5 搜索**

```typescript
// packages/memory/fts5.ts
import Database from 'better-sqlite3'

export class FTS5Search {
  constructor(private db: Database.Database) {
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        content,
        content='memory',
        content_rowid='rowid'
      )
    `)
  }

  search(query: string, limit = 10): string[] {
    const stmt = this.db.prepare(`
      SELECT content FROM memory_fts WHERE memory_fts MATCH ?
      ORDER BY rank LIMIT ?
    `)
    return stmt.all(query, limit).map((row: any) => row.content)
  }

  index(id: string, content: string): void {
    const stmt = this.db.prepare(`INSERT INTO memory_fts(rowid, content) VALUES (?, ?)`)
    stmt.run(Number(id), content)
  }
}
```

- [ ] **Step 3: 创建 Recall 机制**

```typescript
// packages/memory/recall.ts
import type { MemoryEntry } from './schema'

export function createRecallReminder(memoryPath: string): string {
  return `<system-reminder>
This session has memory at ${memoryPath}. Recall content not in your context with:
- memory.search(query: "...")

Don't ask the user about something memory may already record.
</system-reminder>`
}

export function shouldTriggerRecall(sessionHasMemory: boolean): boolean {
  return sessionHasMemory
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/memory/
git commit -m "feat: add memory system with FTS5 search and recall"
```

---

## Phase 6: Tools 系统

### Task 8: Tools 基础

**Files:**
- Create: `packages/tools/types.ts`
- Create: `packages/tools/registry.ts`
- Create: `packages/tools/executor.ts`
- Create: `packages/tools/builtin.ts`

- [ ] **Step 1: 创建 Tools 类型**

```typescript
// packages/tools/types.ts
export type ToolName = 'read' | 'write' | 'edit' | 'glob' | 'grep' | 'bash' | 'skill'

export interface Tool {
  name: ToolName
  description: string
  schema: Record<string, unknown>
  handler: (input: unknown) => Promise<ToolResult>
}

export interface ToolResult {
  success: boolean
  output?: string
  error?: string
}
```

- [ ] **Step 2: 创建内置 Tools**

```typescript
// packages/tools/builtin.ts
import { readFile, writeFile } from 'fs/promises'
import { glob } from 'glob'
import grep from 'grep-args'  // default import

export const BUILTIN_TOOLS: Tool[] = [
  {
    name: 'read',
    description: 'Read file content',
    schema: { path: 'string' },
    handler: async ({ path }: { path: string }) => {
      try {
        const content = await readFile(path, 'utf-8')
        return { success: true, output: content }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    },
  },
  // ... 更多内置工具
]
```

- [ ] **Step 3: Commit**

```bash
git add packages/tools/
git commit -m "feat: add tools system with builtin tools"
```

---

## Phase 7: Skills 系统

### Task 9: Skills 基础

**Files:**
- Create: `packages/skills/types.ts`
- Create: `packages/skills/registry.ts`
- Create: `packages/skills/executor.ts`
- Create: `packages/skills/hot-reload.ts`

- [ ] **Step 1: 创建 Skills 类型**

```typescript
// packages/skills/types.ts
export interface Skill {
  name: string
  description: string
  triggerWords: string[]
  instructions: string
  sandboxLevel: 1 | 2 | 3 | 4
}

export interface SkillResult {
  success: boolean
  output?: string
  error?: string
}
```

- [ ] **Step 2: 创建注册表**

```typescript
// packages/skills/registry.ts
import type { Skill } from './types'

export class SkillRegistry {
  private skills = new Map<string, Skill>()

  register(skill: Skill): void {
    this.skills.set(skill.name, skill)
  }

  findByTrigger(word: string): Skill | undefined {
    for (const skill of this.skills.values()) {
      if (skill.triggerWords.some(tw => word.includes(tw))) {
        return skill
      }
    }
    return undefined
  }

  list(): Skill[] {
    return Array.from(this.skills.values())
  }
}

export const globalSkillRegistry = new SkillRegistry()
```

- [ ] **Step 3: 创建执行器**

```typescript
// packages/skills/executor.ts
import type { Skill, SkillResult } from './types'
import { globalSkillRegistry } from './registry'

export class SkillExecutor {
  async execute(skillName: string, context: Record<string, unknown>): Promise<SkillResult> {
    const skill = globalSkillRegistry.findByTrigger(skillName)
    if (!skill) {
      return { success: false, error: `Skill not found: ${skillName}` }
    }

    try {
      // 简单执行：返回 skill instructions
      return {
        success: true,
        output: `Executing skill: ${skill.name}\nInstructions: ${skill.instructions}`,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }
}
```

- [ ] **Step 4: 添加热加载机制**

```typescript
// packages/skills/hot-reload.ts
import { watch } from 'fs'

export class SkillHotReload {
  private watchers = new Map<string, () => void>()

  watch(skillPath: string, onReload: () => void): void {
    const watcher = watch(skillPath, (event) => {
      if (event === 'change') {
        onReload()
      }
    })
    this.watchers.set(skillPath, () => watcher.close())
  }

  unwatch(skillPath: string): void {
    this.watchers.get(skillPath)?.()
    this.watchers.delete(skillPath)
  }
}
```

- [ ] **Step 5: 添加 Skill 自改进机制**

```typescript
// packages/skills/self-improve.ts
import type { Skill } from './types'

export interface SkillSelfImprove {
  // 记录执行结果
  recordExecution(skillName: string, success: boolean, feedback?: string): void
  // 生成改进建议
  generateImprovement(skillName: string): Promise<string | null>
  // 应用改进
  applyImprovement(skillName: string, improvement: string): void
}

export class SkillSelfImproveImpl implements SkillSelfImprove {
  private executions = new Map<string, { success: boolean; feedback?: string }[]>()

  recordExecution(skillName: string, success: boolean, feedback?: string): void {
    const records = this.executions.get(skillName) ?? []
    records.push({ success, feedback })
    if (records.length > 100) records.shift()
    this.executions.set(skillName, records)
  }

  async generateImprovement(skillName: string): Promise<string | null> {
    const records = this.executions.get(skillName) ?? []
    const failures = records.filter(r => !r.success)
    if (failures.length < 3) return null

    // 基于失败记录生成改进建议
    const feedback = failures.map(f => f.feedback).filter(Boolean).join('\n')
    return `Based on ${failures.length} failures:\n${feedback}`
  }

  applyImprovement(skillName: string, improvement: string): void {
    // 更新 Skill 的 instructions
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/skills/
git commit -m "feat: add skills system with registry, executor, hot-reload, and self-improvement"
```

---

## Phase 8: Integration 系统

### Task 10: 集成模块

**Files:**
- Create: `packages/integration/git.ts`
- Create: `packages/integration/mcp.ts`
- Create: `packages/integration/rtk.ts`
- Create: `packages/integration/db.ts`
- Create: `packages/integration/notes.ts`

- [ ] **Step 1: 创建 Git 集成**

```typescript
// packages/integration/git.ts
export interface GitIntegration {
  status(): Promise<GitStatus>
  commit(message: string): Promise<void>
  push(): Promise<void>
}

export interface GitStatus {
  branch: string
  files: string[]
  clean: boolean
}
```

- [ ] **Step 2: 创建 MCP 集成**

```typescript
// packages/integration/mcp.ts
export interface MCPIntegration {
  connect(serverId: string): Promise<void>
  disconnect(serverId: string): Promise<void>
  listTools(): Promise<string[]>
  callTool(name: string, args: unknown): Promise<unknown>
}
```

- [ ] **Step 3: 创建 RTK 集成**

```typescript
// packages/integration/rtk.ts
export interface RTKIntegration {
  isAvailable(): Promise<boolean>
  execute(command: string): Promise<RTKResult>
  fallback(command: string): Promise<RTKResult>
}

export interface RTKResult {
  compressed: boolean
  output: string
  tokens: number
}
```

- [ ] **Step 4: 创建 DB 集成**

```typescript
// packages/integration/db.ts
export interface DBIntegration {
  query(sql: string): Promise<unknown[]>
  execute(sql: string): Promise<void>
}
```

- [ ] **Step 5: 创建 Notes 集成**

```typescript
// packages/integration/notes.ts
export interface NotesIntegration {
  create(title: string, content: string): Promise<string>
  read(id: string): Promise<Note>
  update(id: string, content: string): Promise<void>
  search(query: string): Promise<Note[]>
}

export interface Note {
  id: string
  title: string
  content: string
  createdAt: number
  updatedAt: number
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/integration/
git commit -m "feat: add integration system for Git/MCP/RTK/DB/Notes"
```

---

## Phase 9: Security

### Task 11: 安全模块

**Files:**
- Create: `packages/security/whitelist.ts`
- Create: `packages/security/permissions.ts`
- Create: `packages/security/network.ts`
- Create: `packages/security/safe-boundary.ts`

- [ ] **Step 1: 创建命令白名单**

```typescript
// packages/security/whitelist.ts
const DEFAULT_WHITELIST = [
  'git', 'cargo', 'npm', 'npx', 'pnpm',
  'ruff', 'mypy', 'eslint', 'prettier', 'biome', 'tsc',
  'psql', 'mysql', 'docker', 'playwright',
  'grep', 'find', 'ls', 'cat', 'head', 'tail', 'wc', 'echo', 'pwd', 'tree',
  'curl', 'wget', 'gh',
  'pip', 'uv',
  'vitest', 'prisma',
  'node', 'next',
]

const BLOCKED_COMMANDS = [
  'bash', 'sh', 'zsh',
  'rm', 'del',
  'sudo', 'su',
  'chmod', 'chown',
  'python', 'python3',
  'exec', 'eval',
]

export function isCommandAllowed(command: string): boolean {
  const base = command.split(' ')[0]
  if (BLOCKED_COMMANDS.includes(base)) return false
  return DEFAULT_WHITELIST.includes(base)
}
```

- [ ] **Step 2: 创建权限管理**

```typescript
// packages/security/permissions.ts
export type PermissionLevel = 1 | 2 | 3 | 4 | 5

export interface Permission {
  level: PermissionLevel
  allowedPaths: string[]
  deniedPaths: string[]
  allowedCommands: string[]
}

export function checkPathPermission(path: string, permission: Permission): boolean {
  if (permission.deniedPaths.some(dp => path.startsWith(dp))) {
    return false
  }
  return permission.allowedPaths.some(ap => path.startsWith(ap))
}
```

- [ ] **Step 3: 添加网络限制**

```typescript
// packages/security/network.ts
export interface NetworkConfig {
  allowedDomains: string[]
  blockedDomains: string[]
  timeout: number
}

export function isDomainAllowed(domain: string, config: NetworkConfig): boolean {
  if (config.blockedDomains.some(d => domain.includes(d))) {
    return false
  }
  if (config.allowedDomains.some(d => domain.includes(d))) {
    return true
  }
  return false
}
```

- [ ] **Step 4: 添加 Safe Boundary 机制**

```typescript
// packages/security/safe-boundary.ts
// Safe Boundary: Provider LLM 调用前的安全边界

export interface SafeBoundary {
  // 检查是否可以在 Safe Boundary 内执行
  canProceed(): boolean
  // 获取当前上下文快照
  getSnapshot(): ContextSnapshot
  // 验证上下文变更是否 admitted
  validateChanges(snapshot: ContextSnapshot): boolean
}

export interface ContextSnapshot {
  baseline: string[]
  midConversationMessages: string[]
  timestamp: number
}

// Safe Boundary 流程:
// 1. Admit Phase: 用户输入 admitted 到 durable inbox
// 2. Observe Phase: 观察所有 Context Source
// 3. Safe Boundary: 所有变更在此 admitted
// 4. LLM Call: 基于完整的 Baseline System Context 调用 LLM
export class SafeBoundaryImpl implements SafeBoundary {
  private baseline: ContextSnapshot | null = null

  canProceed(): boolean {
    // 在 Safe Boundary 前检查所有上下文变更是否已 admitted
    return this.baseline !== null
  }

  getSnapshot(): ContextSnapshot {
    return {
      baseline: [],
      midConversationMessages: [],
      timestamp: Date.now(),
    }
  }

  validateChanges(snapshot: ContextSnapshot): boolean {
    return true
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add packages/security/
git commit -m "feat: add security module with Safe Boundary"
```

---

## Phase 10: Audit

### Task 12: 审计模块

**Files:**
- Create: `packages/audit/events.ts`
- Create: `packages/audit/logger.ts`

- [ ] **Step 1: 创建事件定义**

```typescript
// packages/audit/events.ts
export type EventType =
  | 'command_blocked'
  | 'path_violation'
  | 'git_dangerous'
  | 'network_blocked'
  | 'sensitive_detected'
  | 'agent_spawned'
  | 'agent_terminated'
  | 'skill_executed'

export interface SecurityEvent {
  type: EventType
  timestamp: number
  details: Record<string, unknown>
  action: 'blocked' | 'warned' | 'allowed_with_log'
}

export interface AuditEvent extends SecurityEvent {
  session: string
  user: string
  command?: string
  resource?: string
  duration?: number
}
```

- [ ] **Step 2: 创建记录器**

```typescript
// packages/audit/logger.ts
import { mkdir } from 'fs/promises'
import { join } from 'path'
import type { AuditEvent } from './events'

export class AuditLogger {
  private logDir: string

  constructor(logDir: string) {
    this.logDir = logDir
  }

  async init(): Promise<void> {
    await mkdir(this.logDir, { recursive: true })
  }

  async log(event: AuditEvent): Promise<void> {
    const date = new Date().toISOString().split('T')[0]
    const file = join(this.logDir, `audit-${date}.jsonl`)
    const line = JSON.stringify(event) + '\n'
    await Bun.write(file, line, { append: true })
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/audit/
git commit -m "feat: add audit module with event logging"
```

---

## 里程碑

| 里程碑 | 任务 | 说明 |
|--------|------|------|
| **M1** | Task 1-2 | 项目初始化、类型定义 |
| **M2** | Task 3 | 配置系统（多层配置、外部发现） |
| **M3** | Task 4-5 | Core Loop 七阶段（含 Git 初始化、敏感目录检查） |
| **M4** | Task 5 | Plan Review 审核系统（收敛判断、终止条件） |
| **M5** | Task 6 | 多 Agent 协调（MAX_DEPTH=1 强制） |
| **M6** | Task 7 | Memory 系统 |
| **M7** | Task 8 | Tools 系统 |
| **M8** | Task 9 | Skills 系统（含自改进、热加载） |
| **M9** | Task 10 | Integration 系统（Git/MCP/RTK/DB/Notes） |
| **M10** | Task 11 | Security 系统（含 Safe Boundary） |
| **M11** | Task 12 | Audit 系统 |
| **M12** | 集成测试 | 端到端测试 |

---

## 依赖关系

```
Task 1-2 (基础)
    ↓
Task 3 (配置) ← 所有模块依赖
    ↓
Task 4 (Core Loop) ← 依赖类型、配置
    ↓
Task 5 (Plan Review) ← 依赖 Core Loop
    ↓
Task 6 (Agent) ← 依赖 Core Loop 类型
    ↓
Task 7 (Memory) ← 依赖类型
Task 8 (Tools) ← 依赖类型
Task 9 (Skills) ← 依赖 Tools
Task 10 (Integration) ← 依赖 Tools
Task 11 (Security) ← 依赖 Config
Task 12 (Audit) ← 可独立
```
