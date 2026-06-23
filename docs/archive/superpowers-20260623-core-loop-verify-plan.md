# Core Loop VERIFY 阶段实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 EXECUTE 后增加 VERIFY 阶段，对照 PLAN 承诺的 Deliverables 检查交付物是否真实/正确

**Architecture:** 新建 `packages/core/verify.ts` 实现交付物检查逻辑；改造 `packages/core/types.ts` 增加 Deliverable 类型；改造 `packages/core/loop.ts` 在 EXECUTE 后调用 VERIFY；改造 `packages/core/phases/execute.ts` 的 SYSTEM_PROMPT 引导 LLM 输出 Deliverables

**Tech Stack:** TypeScript, VFM (verify-from-model)

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `packages/core/types.ts` | 增加 `Deliverable`、`CheckType`、`Plan.deliverables` |
| `packages/core/verify.ts` | 新建，实现 `verifyDeliverables()` 检查函数 |
| `packages/core/loop.ts` | `LoopContext` 增加 `plan.deliverables`，EXECUTE 后调用 verify |
| `packages/core/phases/execute.ts` | SYSTEM_PROMPT 改造，引导 LLM 输出 Deliverables |
| `packages/tui/context/loop.tsx` | TUI 展示 VERIFY 状态（进行中/通过/失败） |

---

## Task 1: 类型定义

**Files:**
- Modify: `packages/core/types.ts`

- [ ] **Step 1: 修改 types.ts，增加 Deliverable 相关类型**

```typescript
// packages/core/types.ts

// 增加 CheckType
export type CheckType =
  | 'file_exists'
  | 'contains_pattern'
  | 'has_export'
  | 'has_no_import'
  | 'has_no_error'
  | 'glob_match'

// 增加 Deliverable 接口
export interface Deliverable {
  path?: string           // 文件路径（与 glob 二选一）
  glob?: string          // Glob 模式
  check: CheckType        // 检查类型
  value?: string         // 检查的值（如正则、函数名）
}

// Plan 接口增加 deliverables
export interface Plan {
  steps: string[]
  deliverables?: Deliverable[]  // 新增
}

// LoopContext 中 Plan 类型同步更新
// （已在 ctx.plan?: { steps: string[] } 基础上改）
```

- [ ] **Step 2: 运行构建确认类型正确**

```bash
npm run build
```
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add packages/core/types.ts && git commit -m "feat: add Deliverable and CheckType types for VERIFY phase"
```

---

## Task 2: verify.ts 核心实现

**Files:**
- Create: `packages/core/verify.ts`
- Create: `packages/core/__tests__/verify.test.ts`

- [ ] **Step 1: 写测试用例**

```typescript
// packages/core/__tests__/verify.test.ts
import { verifyDeliverables } from '../verify'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'

const testDir = join(__dirname, '__verify_test_tmp__')

function setup() {
  rmSync(testDir, { force: true, recursive: true })
  mkdirSync(testDir, { recursive: true })
}

function teardown() {
  rmSync(testDir, { force: true, recursive: true })
}

describe('verifyDeliverables', () => {
  beforeEach(setup)
  afterEach(teardown)

  it('file_exists: 文件存在返回 true', async () => {
    writeFileSync(join(testDir, 'foo.txt'), 'hello')
    const results = await verifyDeliverables([
      { path: join(testDir, 'foo.txt'), check: 'file_exists' }
    ])
    expect(results[0].passed).toBe(true)
  })

  it('file_exists: 文件不存在返回 false', async () => {
    const results = await verifyDeliverables([
      { path: join(testDir, 'notexist.txt'), check: 'file_exists' }
    ])
    expect(results[0].passed).toBe(false)
    expect(results[0].message).toContain('notexist.txt')
  })

  it('contains_pattern: 匹配成功返回 true', async () => {
    writeFileSync(join(testDir, 'foo.ts'), 'function calculate() {}')
    const results = await verifyDeliverables([
      { path: join(testDir, 'foo.ts'), check: 'contains_pattern', value: 'function calculate' }
    ])
    expect(results[0].passed).toBe(true)
  })

  it('has_no_import: 无目标 import 返回 true', async () => {
    writeFileSync(join(testDir, 'foo.ts'), "import { foo } from 'bar'")
    const results = await verifyDeliverables([
      { path: join(testDir, 'foo.ts'), check: 'has_no_import', value: 'getUser' }
    ])
    expect(results[0].passed).toBe(true)
  })

  it('has_no_import: 有目标 import 返回 false', async () => {
    writeFileSync(join(testDir, 'foo.ts'), "import { getUser } from 'user'")
    const results = await verifyDeliverables([
      { path: join(testDir, 'foo.ts'), check: 'has_no_import', value: 'getUser' }
    ])
    expect(results[0].passed).toBe(false)
    expect(results[0].message).toContain('getUser')
  })

  it('glob_match: 匹配到文件返回 true', async () => {
    writeFileSync(join(testDir, 'a.ts'), '')
    writeFileSync(join(testDir, 'b.ts'), '')
    const results = await verifyDeliverables([
      { glob: join(testDir, '*.ts'), check: 'glob_match' }
    ])
    expect(results[0].passed).toBe(true)
  })

  it('混合多个 deliverables，全部通过', async () => {
    writeFileSync(join(testDir, 'user.ts'), 'export function getCurrentUser() {}')
    const results = await verifyDeliverables([
      { path: join(testDir, 'user.ts'), check: 'file_exists' },
      { path: join(testDir, 'user.ts'), check: 'contains_pattern', value: 'function getCurrentUser' },
      { path: join(testDir, 'user.ts'), check: 'has_export', value: 'getCurrentUser' },
    ])
    expect(results.every(r => r.passed)).toBe(true)
  })
})
```

- [ ] **Step 2: 运行测试，确认失败（function not defined）**

```bash
npx vitest run packages/core/__tests__/verify.test.ts 2>&1
```
Expected: FAIL — `verifyDeliverables` not defined

- [ ] **Step 3: 实现 verify.ts**

```typescript
// packages/core/verify.ts
import { existsSync, readFileSync } from 'fs'
import { globSync } from 'glob'
import { execSync } from 'child_process'
import type { Deliverable, CheckType } from './types'

export interface VerifyResult {
  passed: boolean
  message?: string
  detail?: string
}

export async function verifyDeliverables(
  deliverables: Deliverable[],
  cwd: string = process.cwd()
): Promise<VerifyResult[]> {
  const results: VerifyResult[] = []

  for (const d of deliverables) {
    try {
      const result = await checkDeliverable(d, cwd)
      results.push(result)
    } catch (err) {
      results.push({
        passed: false,
        message: `检查时出错: ${err instanceof Error ? err.message : String(err)}`
      })
    }
  }

  return results
}

async function checkDeliverable(d: Deliverable, cwd: string): Promise<VerifyResult> {
  switch (d.check) {
    case 'file_exists':
      return checkFileExists(d.path!, cwd)
    case 'contains_pattern':
      return checkContainsPattern(d.path!, d.value!, cwd)
    case 'has_export':
      return checkHasExport(d.path!, d.value!, cwd)
    case 'has_no_import':
      return checkHasNoImport(d.path!, d.value!, cwd)
    case 'has_no_error':
      return checkHasNoError(d.path!, cwd)
    case 'glob_match':
      return checkGlobMatch(d.glob!, cwd)
    default:
      return { passed: false, message: `未知的 check 类型: ${(d as any).check}` }
  }
}

function checkFileExists(path: string, cwd: string): VerifyResult {
  const fullPath = isAbsolute(path) ? path : join(cwd, path)
  const exists = existsSync(fullPath)
  return {
    passed: exists,
    message: exists ? undefined : `文件不存在: ${path}`
  }
}

function checkContainsPattern(path: string, pattern: string, cwd: string): VerifyResult {
  const fullPath = isAbsolute(path) ? path : join(cwd, path)
  if (!existsSync(fullPath)) {
    return { passed: false, message: `文件不存在: ${path}` }
  }
  const content = readFileSync(fullPath, 'utf-8')
  const regex = new RegExp(pattern)
  const found = regex.test(content)
  return {
    passed: found,
    message: found ? undefined : `文件 ${path} 中未找到模式: ${pattern}`
  }
}

function checkHasExport(path: string, exportName: string, cwd: string): VerifyResult {
  const fullPath = isAbsolute(path) ? path : join(cwd, path)
  if (!existsSync(fullPath)) {
    return { passed: false, message: `文件不存在: ${path}` }
  }
  const content = readFileSync(fullPath, 'utf-8')
  // 匹配 export function/name、export const/name、module.exports
  const patterns = [
    new RegExp(`export\\s+(?:function|const|class)\\s+${exportName}`),
    new RegExp(`export\\s+\\{[^}]*\\b${exportName}\\b[^}]*\\}`),
    new RegExp(`module\\.exports\\s*=\\s*{[^}]*\\b${exportName}\\b[^}]*}`),
  ]
  const found = patterns.some(p => p.test(content))
  return {
    passed: found,
    message: found ? undefined : `文件 ${path} 中未找到 export: ${exportName}`
  }
}

function checkHasNoImport(path: string, importName: string, cwd: string): VerifyResult {
  const fullPath = isAbsolute(path) ? path : join(cwd, path)
  if (!existsSync(fullPath)) {
    return { passed: false, message: `文件不存在: ${path}` }
  }
  const content = readFileSync(fullPath, 'utf-8')
  // 匹配 import ... from '...importName...' 或 import "...importName..."
  const regex = new RegExp(`import\\s+[^;]*\\b${importName}\\b[^;]*;`)
  const found = regex.test(content)
  return {
    passed: !found,
    message: !found ? undefined : `文件 ${path} 中仍存在 import: ${importName}`
  }
}

function checkHasNoError(path: string, cwd: string): VerifyResult {
  const fullPath = isAbsolute(path) ? path : join(cwd, path)
  if (!existsSync(fullPath)) {
    return { passed: false, message: `文件不存在: ${path}` }
  }
  try {
    execSync(`npx tsc --noEmit --skipLibCheck "${fullPath}"`, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30000,
    })
    return { passed: true }
  } catch (err: any) {
    return {
      passed: false,
      message: `TypeScript 编译错误: ${path}`,
      detail: err.stdout?.toString() || err.message
    }
  }
}

function checkGlobMatch(globPattern: string, cwd: string): VerifyResult {
  const fullPattern = isAbsolute(globPattern) ? globPattern : join(cwd, globPattern)
  const files = globSync(fullPattern, { cwd })
  return {
    passed: files.length > 0,
    message: files.length > 0 ? undefined : `Glob 模式 ${globPattern} 未匹配到任何文件`
  }
}

function isAbsolute(p: string): boolean {
  return p.startsWith('/') || /^[a-zA-Z]:/.test(p)
}
```

需要 import：
```typescript
import { existsSync, readFileSync } from 'fs'
import { globSync } from 'glob'
import { execSync } from 'child_process'
import { join } from 'path'
```

- [ ] **Step 4: 运行测试，确认全部通过**

```bash
npx vitest run packages/core/__tests__/verify.test.ts 2>&1
```
Expected: PASS (6 tests)

- [ ] **Step 5: 提交**

```bash
git add packages/core/verify.ts packages/core/__tests__/verify.test.ts && git commit -m "feat: add verify.ts with verifyDeliverables for DELIVERABLE checking"
```

---

## Task 3: loop.ts 集成 VERIFY 阶段

**Files:**
- Modify: `packages/core/loop.ts`

- [ ] **Step 1: 修改 Phase 类型，增加 VERIFY**

```typescript
// packages/core/types.ts
export type Phase = 'EXECUTE' | 'VERIFY' | 'DONE'
```

- [ ] **Step 2: 修改 executePhase，在 EXECUTE 后调用 VERIFY**

在 `loop.ts` 的 `executePhase` 方法中：

1. 调用 `execute()` 拿到结果后，检查 `ctx.plan?.deliverables`
2. 如果有 deliverables，调用 `verifyDeliverables()`
3. 全部通过 → 返回 DONE；不通过 → 报告失败项

```typescript
// packages/core/loop.ts
import { verifyDeliverables } from './verify'

// 在 executePhase 末尾（execute 调用之后）加：
if (ctx.plan?.deliverables && ctx.plan.deliverables.length > 0) {
  ctx.onPhaseChange?.('VERIFY')
  const verifyResults = await verifyDeliverables(ctx.plan.deliverables, ctx.cwd)
  const allPassed = verifyResults.every(r => r.passed)
  
  // 通知 TUI
  verifyResults.forEach(r => {
    ctx.onPhaseLog?.(r.passed ? `✓ ${r.message}` : `✗ ${r.message}`)
  })
  
  if (!allPassed) {
    const failed = verifyResults.filter(r => !r.passed)
    return {
      pendingReview: {
        status: 'verify_failed',
        issues: failed.map(f => f.message || '未知错误')
      }
    }
  }
}
```

- [ ] **Step 3: 运行构建确认无错误**

```bash
npm run build
```
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add packages/core/loop.ts packages/core/types.ts && git commit -m "feat: integrate VERIFY phase into CoreLoop after EXECUTE"
```

---

## Task 4: SYSTEM_PROMPT 引导 LLM 输出 Deliverables

**Files:**
- Modify: `packages/core/phases/execute.ts`

- [ ] **Step 1: 修改 SYSTEM_PROMPT，增加 Deliverables 引导**

在 SYSTEM_PROMPT 末尾增加：

```
## 交付物声明（Deliverables）

对于涉及文件创建或修改的任务，请在执行前列出你要交付的内容：

```
Deliverables:
- path: src/foo.ts
  check: file_exists
- path: src/foo.ts
  check: contains_pattern
  value: "function calculate"
- path: src/foo.ts
  check: has_export
  value: "calculate"
```

check 类型说明：
- file_exists: 文件已创建
- contains_pattern: 文件包含指定内容（用 value 指定模式）
- has_export: 文件 export 了指定名称
- has_no_import: 文件不包含指定 import（用于确认旧代码已清理）
- has_no_error: 文件无 TypeScript 编译错误

示例：
用户：帮我创建一个 user.ts，包含 getUser 函数
你：
```
Plan:
1. 创建 src/user.ts
2. 实现 getUser 函数
3. 导出 getUser

Deliverables:
- path: src/user.ts
  check: file_exists
- path: src/user.ts
  check: contains_pattern
  value: "function getUser"
- path: src/user.ts
  check: has_export
  value: "getUser"
```
```

- [ ] **Step 2: 运行构建确认无错误**

```bash
npm run build
```

- [ ] **Step 3: 提交**

```bash
git add packages/core/phases/execute.ts && git commit -m "feat: add Deliverables guidance to SYSTEM_PROMPT for VERIFY phase"
```

---

## Task 5: TUI 展示 VERIFY 状态

**Files:**
- Modify: `packages/tui/context/loop.tsx`
- Modify: `packages/tui/component/message-list.tsx` 或 `packages/tui/routes/home.tsx`

- [ ] **Step 1: LoopContext 增加 VERIFY 状态**

在 `packages/tui/context/loop.tsx` 中：

```typescript
// 找到现有的 phase 状态，增加 verify 状态
const [verifyStatus, setVerifyStatus] = createSignal<{
  passed: boolean
  results: Array<{ passed: boolean; message?: string }>
} | null>(null)

// onPhaseChange 回调中处理 VERIFY phase
useEffect(() => {
  if (phase === 'VERIFY') {
    setVerifyStatus({ passed: false, results: [] })
  }
}, [phase])
```

- [ ] **Step 2: home.tsx 中当 phase === 'VERIFY' 时显示状态**

在 `home.tsx` 的消息列表区域，当 `phase === 'VERIFY'` 时展示进度：

```tsx
<Show when={phase() === 'VERIFY'}>
  <box flexDirection="column" marginBottom={1}>
    <text fg={primary()}>🔍 验证交付物...</text>
    <For each={verifyResults()}>
      {(r) => (
        <text fg={r.passed ? success() : error()}>
          {r.passed ? '✓' : '✗'} {r.message}
        </text>
      )}
    </For>
  </box>
</Show>
```

- [ ] **Step 3: 构建确认无错误**

```bash
npm run build
```

- [ ] **Step 4: 提交**

```bash
git add packages/tui/context/loop.tsx packages/tui/routes/home.tsx && git commit -m "feat: show VERIFY phase status in TUI"
```

---

## 执行方式

计划完成，保存到 `docs/superpowers/plans/20260623-core-loop-verify-plan.md`。

两个执行选项：

**1. Subagent-Driven（推荐）** — 每个 Task 由独立 subagent 完成，每完成一个 Task 经过评审再继续

**2. Inline Execution** — 在这个 session 内顺序执行所有 Task，批量完成后统一验证

选哪个？
