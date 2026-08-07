# 架构重构实施计划

**目标**：拆解 God Context、抽取 LLM 调用层、引入轻量 DI、清理冗余模块，提升代码可维护性和测试性

**日期**：2025-08-07
**更新**：2025-08-07（同步未提交改动）

---

## 背景

基于 2025-08-07 的架构审视报告，licode 存在以下核心问题：

1. `loop.tsx` (960 行) 承载 30+ 状态，职责过重
2. `execute/main.ts` (560 行) 的 `callLLM` 函数复杂度高
3. `core/loop.ts` 依赖过多，测试难 mock
4. `session/query-builder.ts` (525 行) 可读性差

---

## 当前进度

### ✅ Phase 1 已完成：Context 拆分集成

| 文件 | 行数 | 职责 | 状态 |
|---|---:|----|---|
| `loop.tsx` | 759 | 组合层（核心逻辑） | ✅ 已重构（960→759，-21%） |
| `message.tsx` | 100 | 消息状态管理 | ✅ 已创建并集成 |
| `loop-model.tsx` | 73 | 模型/Provider 切换 | ✅ 已集成 |
| `loop-skill.tsx` | 103 | Skill 状态管理 | ✅ 已集成 |
| `loop-stream.tsx` | 80 | 流式输出状态 | ✅ 已集成 |
| `loop-subagent.tsx` | 73 | Subagent 状态跟踪 | ✅ 已集成 |
| `loop-scheduler.tsx` | 70 | 定时任务管理 | ✅ 已集成 |
| `loop-input.tsx` | 52 | 输入队列管理 | ✅ 已集成 |

### 🔄 Phase 2 待开始：抽取 LLM 调用层

---

## 总体策略（更新后）

**分 4 阶段执行**，每阶段独立可交付：

1. **Phase 1**：完成 loop.tsx 集成（1-2 天）← **当前阶段**
2. **Phase 2**：抽取 LLM 调用层（2 天）
3. **Phase 3**：引入轻量 DI（2 天）
4. **Phase 4**：清理 query-builder + 依赖整理（1-2 天）

---

## Phase 1: 完成 loop.tsx 集成（当前）

### 目标
将已创建的 6 个 context 文件集成到 loop.tsx，将 960 行精简到 ~400 行。

### Step 1.1: 创建 MessageContext（待完成）

**位置**：`packages/tui/context/message.tsx`

**职责**：
- 消息列表 CRUD (`messages`, `addMessage`, `updateMessage`, `clearMessages`)
- 流式防抖逻辑 (`_pendingFlushTimer`, `_segmentFlushTimer`)
- 消息历史恢复

**需迁移的代码**（约 150 行）：
```typescript
const [messages, setMessages] = createSignal<Message[]>([])
let _pendingFlushTimer: ReturnType<typeof setTimeout> | null = null
let _latestPending = ''
// ... 防抖逻辑约 40 行
```

**verify**：
```bash
bunx tsc --noEmit --skipLibCheck
bun test packages/tui/__tests__/
```

---

### Step 1.2: 集成已有 Context 到 loop.tsx

**当前状态**：6 个 context 文件已创建，但 loop.tsx 未引用。

**集成方式**：
```typescript
// packages/tui/context/loop.tsx
import { createModelState } from './loop-model'
import { createSkillState } from './loop-skill'
import { createStreamState } from './loop-stream'
import { createSubagentState } from './loop-subagent'
import { createSchedulerState } from './loop-scheduler'
import { createInputState } from './loop-input'
import { createMessageState } from './message'  // 新建

export function LoopProvider(props: ...) {
  // 使用各 context 的 create 函数
  const model = createModelState(props.provider, props.model?.modelId)
  const skill = createSkillState()
  const stream = createStreamState()
  const subagent = createSubagentState()
  const scheduler = createSchedulerState()
  const input = createInputState()
  const message = createMessageState()
  
  // 组合所有状态到 LoopContext
  // ...
}
```

**verify**：
```bash
# 类型检查
bunx tsc --noEmit --skipLibCheck

# 全量测试
bun test

# 手动功能验证
bun run dev
# 测试场景：
# 1. 发送消息，观察消息列表更新
# 2. 切换模型，观察模型状态
# 3. 使用 skill，观察 skill 状态
# 4. 中断操作，观察 abort 处理
```

---

### Step 1.3: 清理 loop.tsx 残留代码

**目标**：删除已迁移到各 context 的重复代码

**需删除**：
- `createModelState` 相关的 signal 定义和函数
- `createSkillState` 相关的 signal 定义和函数
- `createStreamState` 相关的 signal 定义和函数
- `createSubagentState` 相关的 signal 定义和函数
- `createSchedulerState` 相关的 signal 定义和函数
- `createInputState` 相关的 signal 定义和函数

**verify**：
```bash
# 确认 loop.tsx 行数减少到 ~400 行
wc -l packages/tui/context/loop.tsx

# 类型检查
bunx tsc --noEmit --skipLibCheck

# 全量测试
bun test
```

---

### Step 1.4: 添加单元测试

**位置**：`packages/tui/__tests__/context/`

**测试文件**：
- `message.test.ts` — 消息 CRUD + 流式防抖
- `model.test.ts` — 模型切换 + token 统计
- `skill.test.ts` — skill 激活 + 建议
- `subagent.test.ts` — subagent 状态

**verify**：
```bash
bun test packages/tui/__tests__/context/
```

---

## Phase 2: 抽取 LLM 调用层

### 目标
将 `execute/main.ts` 中的 `callLLM` 函数抽取为独立模块，便于测试和维护。

### Step 2.1: 创建 llm-client.ts

**位置**：`packages/core/llm-client.ts`

**职责**：
- LLM 调用封装（超时、abort、流消费）
- 内存泄漏防护逻辑
- usage 统计

**需迁移的代码**（约 150 行）：
```typescript
async function callLLM(
  msgs: Array<{ role: string; content: MessageContent[] }>,
  ctx: ExecuteContext,
  tools: Record<string, Tool>,
  system: string,
): Promise<{ result: LLMResult; duration: number } | null> {
  // 超时处理
  const timeoutMs = 60_000
  const timeoutController = new AbortController()
  // ...
  
  // 流消费 + 内存泄漏修复
  try {
    await streamResult.consumeStream()
  } finally {
    // 强制清理
  }
}
```

**verify**：
```bash
bunx tsc --noEmit --skipLibCheck
bun test packages/core/__tests__/llm-client.test.ts
```

---

### Step 2.2: 创建 tool-executor.ts

**位置**：`packages/core/tool-executor.ts`

**职责**：
- 工具调用执行
- 结果处理 + 超时
- 重试逻辑（如有）

**需迁移的代码**（约 80 行）：
```typescript
async function executeTool(
  name: string,
  input: unknown,
  registry: ToolRegistry,
  ctx: ToolContext
): Promise<ToolResult> {
  // 执行 + 错误处理
}
```

**verify**：
```bash
bunx tsc --noEmit --skipLibCheck
```

---

### Step 2.3: 重构 execute/main.ts

**重构后职责**：
- 编排 LLM 调用和工具执行
- 流式文本处理
- 回调触发

**目标行数**：~350 行（从 560 行减少 40%）

**verify**：
```bash
bunx tsc --noEmit --skipLibCheck
bun test
bun run dev
# 测试场景：
# 1. 发送简单问题，观察 LLM 响应
# 2. 触发工具调用（如读文件），观察执行
# 3. 长时间操作，测试超时处理
```

---

## Phase 3: 引入轻量 DI

### 目标
通过依赖注入解耦 `core/loop.ts` 的依赖，便于测试和扩展。

### Step 3.1: 创建 Container

**位置**：`packages/core/container.ts`

**实现**：
```typescript
export class Container {
  private services = new Map<string, () => any>()
  private singletons = new Map<string, any>()

  register<T>(key: string, factory: () => T, singleton = false): void {
    this.services.set(key, factory)
    if (singleton) {
      this.singletons.set(key, factory())
    }
  }

  resolve<T>(key: string): T {
    if (this.singletons.has(key)) {
      return this.singletons.get(key) as T
    }
    const factory = this.services.get(key)
    if (!factory) {
      throw new Error(`Service not registered: ${key}`)
    }
    return factory() as T
  }
}

export const container = new Container()
```

**verify**：
```bash
bunx tsc --noEmit --skipLibCheck
bun test packages/core/__tests__/container.test.ts
```

---

### Step 3.2: 注册核心服务

**位置**：`packages/core/services.ts`

**需注册的服务**：
```typescript
container.register('sessionManager', () => new SessionManager(), true)
container.register('memory', () => new Memory(), true)
container.register('pluginManager', () => pluginManager, true)
container.register('gitIntegration', () => new GitIntegration(), true)
container.register('sessionCompactor', () => new SessionCompactor(), true)
```

**verify**：
```bash
bunx tsc --noEmit --skipLibCheck
```

---

### Step 3.3: 重构 core/loop.ts

**重构后**：
- 通过 container 获取依赖
- `LoopContext` 回调保持不变（用于 UI 层）
- 初始化逻辑简化

**目标行数**：~300 行（从 410 行减少 25%）

**verify**：
```bash
bunx tsc --noEmit --skipLibCheck
bun test
bun run dev
```

---

## Phase 4: 清理 query-builder + 依赖整理

### 目标
提升 `session` 模块的可读性，整理跨模块依赖。

### Step 4.1: 重构 query-builder.ts

**位置**：`packages/session/utils/query-builder.ts`

**重构方向**：
- 移到 `utils/` 子目录
- 拆分为多个小函数（每个 SQL 操作一个函数）
- 添加 JSDoc 注释

**verify**：
```bash
bunx tsc --noEmit --skipLibCheck
bun test packages/session/
```

---

### Step 4.2: 整理跨模块依赖

**需处理的依赖**：

| 问题 | 解决方案 |
|---|---|
| `config/defaults.ts` → `security/merge.ts` | 将默认值内聚到 config 内部 |
| `extension/types.ts` → `skills/types.ts` | 抽取共享类型到 `packages/shared/types.ts` |
| `core/loop.ts` → 多个依赖 | Phase 3 已处理 |

**verify**：
```bash
bunx tsc --noEmit --skipLibCheck
bun test
npx madge --circular packages/
```

---

### Step 4.3: 清理 dead code

**检查点**：
- [ ] 删除未使用的 import
- [ ] 删除注释掉的代码
- [ ] 删除空的 catch 块（或添加 devLogger）
- [ ] 统一日志格式

**verify**：
```bash
bunx tsc --noEmit --skipLibCheck
bun test
bun run dev
```

---

## 不做什么

- ❌ 不重构 TUI 组件渲染逻辑（只重构 context）
- ❌ 不修改 Core Loop 的执行逻辑（只抽取调用层）
- ❌ 不引入重量级 DI 框架（inversify/typedi）
- ❌ 不重写 session 持久化逻辑
- ❌ 不修改安全层逻辑（只调整依赖方向）

---

## 风险与缓解

| 风险 | 缓解措施 |
|---|---|
| Context 拆分导致状态不同步 | 每步验证 + 全量测试 |
| LLM 调用层抽取引入 bug | 保留原函数作为 fallback |
| DI 引入性能开销 | 只注册单例，避免频繁 resolve |
| 重构期间功能回归 | 每阶段独立可交付，可暂停 |

---

## 完成标准

- [ ] 所有阶段的 verify check 通过
- [ ] `bunx tsc --noEmit --skipLibCheck` 无错误
- [ ] `bun test` 全部通过
- [ ] 手动功能验证无异常
- [ ] 代码行数减少 30%+（loop.tsx: 960→400, execute/main.ts: 560→350）
- [ ] 新增 context 单元测试覆盖率 > 80%

---

## 时间估算（更新后）

| 阶段 | 工作量 | 依赖 | 状态 |
|---|---|---|---|
| Phase 1 | 1-2 天 | 无 | ✅ **已完成** |
| Phase 2 | 2 天 | Phase 1 完成 | 🔄 **待开始** |
| Phase 3 | 2 天 | Phase 2 完成 | 待开始 |
| Phase 4 | 1-2 天 | Phase 3 完成 | 待开始 |
| **总计** | **6-8 天** | - | **已完成 1/4** |

---

## 参考文档

- [架构审视报告](./architecture-review-2025-08-07.md)
- [codebase-design skill](~/.claude/skills/codebase-design/SKILL.md)
- [simplify skill](~/.claude/skills/simplify/SKILL.md)
