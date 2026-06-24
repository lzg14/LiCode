# /loop 定时执行命令实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 licode 添加 `/loop [interval] [prompt]` 命令，支持定时重复执行 prompt

**Architecture:** 在 TUI 层添加 slash 命令分发 + 独立的 scheduler 模块管理定时任务，触发时调用 `run(prompt)` 喂给 CoreLoop

**Tech Stack:** TypeScript, setTimeout/setInterval, SolidJS signals

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `packages/core/scheduler.ts` | 定时任务调度器（创建/取消/列表） |
| `packages/tui/routes/home.tsx` | `/loop` slash 命令分发 |
| `packages/tui/context/loop.tsx` | 暴露 `run` 给 scheduler 调用 |
| `packages/core/__tests__/scheduler.test.ts` | 调度器单元测试 |

---

### Task 1: 实现 Scheduler 模块

**Files:**
- Create: `packages/core/scheduler.ts`
- Create: `packages/core/__tests__/scheduler.test.ts`

- [ ] **Step 1: 写 scheduler 接口定义**

```typescript
// packages/core/scheduler.ts
export interface ScheduledTask {
  id: string
  prompt: string
  intervalMs: number
  timerId: ReturnType<typeof setTimeout>
  createdAt: number
  runCount: number
}

export interface SchedulerCallbacks {
  onTrigger: (prompt: string) => Promise<void>
  onLog: (msg: string) => void
}

export class Scheduler {
  private tasks = new Map<string, ScheduledTask>()
  private callbacks: SchedulerCallbacks

  constructor(callbacks: SchedulerCallbacks) {
    this.callbacks = callbacks
  }

  parseInterval(input: string): number | null {
    const match = input.match(/^(\d+)(s|m|h|d)$/)
    if (!match) return null
    const [, num, unit] = match
    const n = parseInt(num, 10)
    switch (unit) {
      case 's': return n * 1000
      case 'm': return n * 60 * 1000
      case 'h': return n * 60 * 60 * 1000
      case 'd': return n * 24 * 60 * 60 * 1000
      default: return null
    }
  }

  create(intervalMs: number, prompt: string): string {
    const id = `loop_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`

    const tick = async () => {
      const task = this.tasks.get(id)
      if (!task) return
      task.runCount++
      this.callbacks.onLog(`[loop] 第 ${task.runCount} 次执行: ${prompt}`)
      try {
        await this.callbacks.onTrigger(prompt)
      } catch (e) {
        this.callbacks.onLog(`[loop] 执行出错: ${e instanceof Error ? e.message : String(e)}`)
      }
      // 重新调度下一次
      const newTimerId = setTimeout(tick, intervalMs)
      task.timerId = newTimerId
    }

    const timerId = setTimeout(tick, intervalMs)
    const task: ScheduledTask = {
      id, prompt, intervalMs, timerId,
      createdAt: Date.now(), runCount: 0,
    }
    this.tasks.set(id, task)
    return id
  }

  delete(id: string): boolean {
    const task = this.tasks.get(id)
    if (!task) return false
    clearTimeout(task.timerId)
    this.tasks.delete(id)
    return true
  }

  deleteAll(): number {
    let count = 0
    for (const [id] of this.tasks) {
      this.delete(id)
      count++
    }
    return count
  }

  list(): Omit<ScheduledTask, 'timerId'>[] {
    return Array.from(this.tasks.values()).map(t => {
      const { timerId, ...rest } = t
      return rest
    })
  }

  hasTasks(): boolean {
    return this.tasks.size > 0
  }
}
```

- [ ] **Step 2: 写 scheduler 单元测试**

```typescript
// packages/core/__tests__/scheduler.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Scheduler } from '../scheduler'

describe('Scheduler', () => {
  let scheduler: Scheduler
  let onTrigger: ReturnType<typeof vi.fn>
  let onLog: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    onTrigger = vi.fn().mockResolvedValue(undefined)
    onLog = vi.fn()
    scheduler = new Scheduler({ onTrigger, onLog })
  })

  afterEach(() => {
    scheduler.deleteAll()
    vi.useRealTimers()
  })

  it('parseInterval 解析各种格式', () => {
    expect(scheduler.parseInterval('5m')).toBe(5 * 60 * 1000)
    expect(scheduler.parseInterval('30s')).toBe(30 * 1000)
    expect(scheduler.parseInterval('2h')).toBe(2 * 60 * 60 * 1000)
    expect(scheduler.parseInterval('1d')).toBe(24 * 60 * 60 * 1000)
    expect(scheduler.parseInterval('abc')).toBeNull()
    expect(scheduler.parseInterval('5x')).toBeNull()
    expect(scheduler.parseInterval('')).toBeNull()
  })

  it('create 创建任务并定时触发', async () => {
    const id = scheduler.create(60_000, 'test prompt')
    expect(id).toBeTruthy()
    expect(scheduler.list()).toHaveLength(1)

    // 未到时间不触发
    vi.advanceTimersByTime(59_000)
    expect(onTrigger).not.toHaveBeenCalled()

    // 到时间触发
    vi.advanceTimersByTime(1_000)
    expect(onTrigger).toHaveBeenCalledWith('test prompt')
  })

  it('delete 取消任务', () => {
    const id = scheduler.create(60_000, 'test')
    expect(scheduler.delete(id)).toBe(true)
    expect(scheduler.list()).toHaveLength(0)

    vi.advanceTimersByTime(60_000)
    expect(onTrigger).not.toHaveBeenCalled()
  })

  it('delete 不存在的 id 返回 false', () => {
    expect(scheduler.delete('nonexistent')).toBe(false)
  })

  it('deleteAll 清空所有任务', () => {
    scheduler.create(60_000, 'a')
    scheduler.create(60_000, 'b')
    expect(scheduler.deleteAll()).toBe(2)
    expect(scheduler.list()).toHaveLength(0)
  })

  it('hasTasks 判断是否有任务', () => {
    expect(scheduler.hasTasks()).toBe(false)
    const id = scheduler.create(60_000, 'test')
    expect(scheduler.hasTasks()).toBe(true)
    scheduler.delete(id)
    expect(scheduler.hasTasks()).toBe(false)
  })

  it('触发后自动重新调度', async () => {
    scheduler.create(30_000, 'repeat')

    // 第一次触发
    vi.advanceTimersByTime(30_000)
    expect(onTrigger).toHaveBeenCalledTimes(1)

    // 第二次触发
    vi.advanceTimersByTime(30_000)
    expect(onTrigger).toHaveBeenCalledTimes(2)
  })

  it('执行出错不影响后续调度', async () => {
    onTrigger.mockRejectedValueOnce(new Error('fail'))
    scheduler.create(10_000, 'test')

    vi.advanceTimersByTime(10_000)
    expect(onTrigger).toHaveBeenCalledTimes(1)
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('执行出错'))

    // 下一次仍然触发
    vi.advanceTimersByTime(10_000)
    expect(onTrigger).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 3: 运行测试验证通过**

Run: `npx vitest run packages/core/__tests__/scheduler.test.ts`
Expected: 全部 PASS

- [ ] **Step 4: Commit**

```bash
git add packages/core/scheduler.ts packages/core/__tests__/scheduler.test.ts
git commit -m "feat(core): add Scheduler for periodic task execution"
```

---

### Task 2: 在 LoopContext 暴露 scheduler 实例

**Files:**
- Modify: `packages/tui/context/loop.tsx`

- [ ] **Step 1: 在 loop context 中创建 scheduler**

在 `LoopProvider` 组件中：
1. import `Scheduler` from `../../core/scheduler`
2. 创建 scheduler 实例，`onTrigger` 调用 `run(prompt)`
3. 导出 `scheduler`、`addLoop`、`removeLoop`、`listLoops` 给组件使用

关键代码：
```typescript
import { Scheduler } from "../../core/scheduler"

// 在 LoopProvider 内部
const scheduler = new Scheduler({
  onTrigger: async (prompt: string) => {
    await run(prompt)
  },
  onLog: (msg: string) => {
    addMessage({ role: "system", content: msg })
  },
})

const addLoop = (interval: string, prompt: string) => {
  const ms = scheduler.parseInterval(interval)
  if (!ms) {
    addMessage({ role: "system", content: `无效的时间格式: ${interval}。支持: 30s, 5m, 2h, 1d` })
    return null
  }
  const id = scheduler.create(ms, prompt)
  addMessage({ role: "system", content: `循环已启动 (ID: ${id})\n间隔: ${interval}\nPrompt: ${prompt}\n输入 /loop stop 停止` })
  return id
}

const stopLoops = () => {
  const count = scheduler.deleteAll()
  addMessage({ role: "system", content: count > 0 ? `已停止 ${count} 个循环` : "没有运行中的循环" })
}

const listLoops = () => {
  const tasks = scheduler.list()
  if (tasks.length === 0) {
    addMessage({ role: "system", content: "没有运行中的循环" })
    return
  }
  const lines = tasks.map(t => {
    const mins = Math.round(t.intervalMs / 60_000)
    return `  ${t.id} | 每 ${mins}m | 已执行 ${t.runCount} 次 | ${t.prompt}`
  })
  addMessage({ role: "system", content: `运行中的循环 (${tasks.length}):\n${lines.join('\n')}` })
}
```

- [ ] **Step 2: 导出新接口**

更新 context 的类型定义，导出 `addLoop`、`stopLoops`、`listLoops`。

- [ ] **Step 3: Commit**

```bash
git add packages/tui/context/loop.tsx
git commit -m "feat(tui): expose scheduler in LoopContext"
```

---

### Task 3: 在 home.tsx 注册 /loop 命令

**Files:**
- Modify: `packages/tui/routes/home.tsx`

- [ ] **Step 1: 在 handleSubmit 中添加 /loop 分发**

```typescript
// 在 handleSubmit 中，/skill 之后添加
if (text.startsWith('/loop')) {
  const arg = text.slice(5).trim()
  if (!arg || arg === 'list') {
    listLoops()
    return
  }
  if (arg === 'stop' || arg === 'off' || arg === 'cancel') {
    stopLoops()
    return
  }
  // 解析: /loop 5m check deploy
  // 或: /loop check deploy (无间隔，使用默认 5m)
  const parts = arg.split(/\s+/)
  const firstPart = parts[0]
  const maybeInterval = scheduler.parseInterval(firstPart)
  if (maybeInterval) {
    const prompt = parts.slice(1).join(' ')
    if (!prompt) {
      addMessage({ role: "system", content: "用法: /loop <interval> <prompt>\n示例: /loop 5m check deploy status" })
      return
    }
    addLoop(firstPart, prompt)
  } else {
    // 没有 interval，整个 arg 作为 prompt，使用默认 5m
    addLoop('5m', arg)
  }
  return
}
```

- [ ] **Step 2: 从 useLoop 解构新接口**

```typescript
const { isProcessing, messages, run, ..., addLoop, stopLoops, listLoops, scheduler } = useLoop()
```

- [ ] **Step 3: 在 slash 菜单中添加 /loop**

```typescript
// slashItems 中添加
{ type: 'cmd', label: '/loop', desc: '定时重复执行 prompt' },
```

- [ ] **Step 4: Commit**

```bash
git add packages/tui/routes/home.tsx
git commit -m "feat(tui): add /loop command for scheduled task execution"
```

---

### Task 4: 添加 /loop stop 快捷键和 Esc 停止

**Files:**
- Modify: `packages/tui/routes/home.tsx`

- [ ] **Step 1: Esc 键停止所有循环**

在 `useKeyboard` 中添加：
```typescript
if (evt.name === "escape" && !helpOpen() && !modelPickerOpen() && !slashOpen()) {
  if (scheduler.hasTasks()) {
    evt.preventDefault()
    stopLoops()
    return
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/tui/routes/home.tsx
git commit -m "feat(tui): stop loops on Esc key"
```

---

### Task 5: 集成测试

- [ ] **Step 1: 手动测试**

启动 licode，输入以下命令验证：
```
/loop 10s hello
/loop list
/loop stop
/loop 30s /help
```

- [ ] **Step 2: 运行全量测试**

Run: `npx vitest run`
Expected: 全部 PASS

- [ ] **Step 3: 最终 Commit**

```bash
git add -A
git commit -m "feat: add /loop command for periodic prompt execution"
```
