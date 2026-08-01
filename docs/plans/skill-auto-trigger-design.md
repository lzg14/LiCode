# Skill 自动触发系统设计方案

**日期**：2026-08-01  
**状态**：实现中 - 代码审查完成，待修复

---

## 1. 现状分析

### 1.1 现有架构

```
.claude/skills/
├── tdd/SKILL.md          # 测试驱动开发
├── debugging/SKILL.md    # 调试纪律
├── planning/SKILL.md     # 多步计划
├── verification/SKILL.md # 完工自证
├── simplify/SKILL.md     # 代码瘦身
├── parallel-agents/SKILL.md
├── architecture/SKILL.md
├── codebase-design/SKILL.md
├── domain-modeling/SKILL.md
├── finishing-branch/SKILL.md
├── git-worktrees/SKILL.md
├── grilling/SKILL.md
└── writing-skills/SKILL.md
```

### 1.2 当前加载流程

```
启动 → home.tsx scanSkills() → loadAllSkills(cwd)
                                    ├── ~/.claude/skills/
                                    ├── ~/.licode/skills/
                                    └── 项目/.claude/skills/
                               → globalSkillRegistry.register()
```

加载正常，13 个 skill 全部可被发现。

### 1.3 当前触发流程

```
用户输入 → AI 回复 → 结束

手动触发：用户输入 /skill-name → setActiveSkill() → 注入 system prompt
```

### 1.4 核心问题

| 问题 | 影响 |
|------|------|
| `findByTrigger()` 从未被调用 | 自动触发完全失效 |
| `triggerWords` 只有 skill 名称 | `"tdd"` 无法匹配用户自然语言 |
| System prompt 无 skill 索引 | AI 不知道有哪些 skill 可调用 |
| skill tool 描述太笼统 | AI 不知道何时该调用 skill 工具 |
| 无多 skill 建议机制 | 同一任务可能适用多个 skill |

---

## 2. 设计目标

1. **AI 知道有哪些 skill** — system prompt 中注入 skill 索引
2. **AI 能判断何时用 skill** — skill tool 描述增强 + 结构化元数据
3. **用户可确认/拒绝** — 自动建议而非强制
4. **兼容现有 SKILL.md 格式** — 不改动 `.claude/skills/` 文件
5. **渐进增强** — 第一阶段纯规则，后续可加 LLM 判断

---

## 3. 方案设计

### 3.1 整体架构

```
用户输入
  │
  ▼
┌─────────────────────┐
│ Phase 1: Skill 索引  │  ← system prompt 注入 skill 摘要
│ (AI 自主决定是否调用) │
└─────────────────────┘
  │
  ▼
┌─────────────────────┐
│ Phase 2: 自动建议    │  ← 规则匹配 + AI 确认
│ (用户可确认/拒绝)    │
└─────────────────────┘
  │
  ▼
┌─────────────────────┐
│ Phase 3: 多 Skill    │  ← 同时激活多个兼容 skill
│ 组合 (未来)          │
└─────────────────────┘
```

### 3.2 Phase 1: Skill 索引注入（最小改动，立即生效）

**核心思路**：在 system prompt 中注入 skill 列表摘要，让 AI 知道有哪些 skill 以及何时使用。

**改动位置**：`packages/core/phases/execute/main.ts` → `buildSystem()`

```typescript
// 改动前
function buildSystem(ctx, projectConfig, intelligenceHints) {
  let sys = SYSTEM_PROMPT.replace(...)
  if (projectConfig) sys += `\n\n## 项目配置\n\n${projectConfig}`
  if (ctx.activeSkillInstructions) {
    sys += `\n\n## 当前激活技能: ${ctx.activeSkill}\n\n${ctx.activeSkillInstructions}`
  }
  return sys
}

// 改动后
function buildSystem(ctx, projectConfig, intelligenceHints) {
  let sys = SYSTEM_PROMPT.replace(...)
  if (projectConfig) sys += `\n\n## 项目配置\n\n${projectConfig}`
  if (ctx.activeSkillInstructions) {
    sys += `\n\n## 当前激活技能: ${ctx.activeSkill}\n\n${ctx.activeSkillInstructions}`
  }
  // 新增：注入可用 skill 索引
  if (ctx.availableSkills?.length > 0) {
    sys += `\n\n## 可用技能\n\n${buildSkillIndex(ctx.availableSkills)}`
  }
  return sys
}
```

**索引格式**：

```markdown
## 可用技能

以下技能可通过 `skill` 工具激活。当用户任务匹配触发条件时，应先激活对应技能再执行。

| 技能 | 描述 | 何时用 |
|------|------|--------|
| tdd | 测试驱动开发 | 写新功能、修 bug 后写测试、重构 |
| debugging | 调试纪律 | 根因不明的 bug、性能回退 |
| planning | 多步计划 | 任务跨多文件/多步骤 |
| verification | 完工自证 | 准备说"完成"、commit 前 |
| simplify | 代码瘦身 | 过度设计、想精简代码 |
| parallel-agents | 并行 agent | 可拆成无依赖子任务 |
| finishing-branch | 分支完工 | 任务完成，准备 merge/PR |
| architecture | 架构审视 | 项目架构健康检查 |
| codebase-design | 代码库设计 | 理解模块边界 |
| domain-modeling | 领域建模 | 设计数据模型 |
| git-worktrees | Git worktree | 需要隔离环境 |
| grilling | 深度审查 | 代码/设计深度审查 |
| writing-skills | 写 skill | 创建新 skill |

激活方式：调用 `skill` 工具，参数 `{ "name": "<技能名>" }`。
```

**数据流**：

```
loadAllSkills(cwd)
  → ctx.availableSkills = skills.map(s => ({
      name: s.name,
      description: s.description,
      triggerHints: extractTriggerHints(s.instructions)  // 从 instructions 中提取"何时用"段落
    }))
  → buildSystem() 注入索引
```

**Token 开销估算**：~300 tokens（13 个 skill 摘要），可接受。

---

### 3.3 Phase 2: 规则自动建议

**核心思路**：用户消息进入时，用规则匹配预判可能适用的 skill，在 UI 上提示用户确认。

**改动位置**：`packages/tui/context/loop.tsx` → `run()`

```typescript
const run = async (input: string, opts?) => {
  // ... 现有逻辑 ...

  // 新增：自动建议
  const suggested = await suggestSkills(cleanText, activeSkill())
  if (suggested.length > 0 && !activeSkill()) {
    // 在 UI 上显示建议，等待用户确认
    const confirmed = await showSkillSuggestion(suggested)
    if (confirmed) {
      await setActiveSkill(confirmed.name)
    }
  }

  // ... 继续执行 ...
}
```

**匹配规则**：

```typescript
// packages/skills/auto-suggest.ts

interface SkillRule {
  skill: string
  patterns: RegExp[]
  keywords: string[]
  excludePatterns?: RegExp[]  // 排除条件
}

const SKILL_RULES: SkillRule[] = [
  {
    skill: 'tdd',
    patterns: [
      /写.*测试|写.*test/i,
      /测试驱动|tdd/i,
      /新功能.*实现|实现.*新功能/i,
    ],
    keywords: ['测试', 'test', 'tdd', '新功能', 'feature'],
    excludePatterns: [/修.*bug|fix.*bug/i],  // 修 bug 用 debugging
  },
  {
    skill: 'debugging',
    patterns: [
      /bug|调试|debug/i,
      /报错|error|异常/i,
      /不工作|不运行|跑不通/i,
    ],
    keywords: ['bug', '调试', 'debug', '报错', '异常'],
  },
  {
    skill: 'planning',
    patterns: [
      /重构.*模块|模块.*重构/i,
      /多.*文件|跨.*文件/i,
      /计划|plan|方案/i,
    ],
    keywords: ['重构', 'refactor', '计划', '方案'],
  },
  {
    skill: 'verification',
    patterns: [
      /完成|修好了|搞定了|可以了/i,
      /commit|提交|push/i,
      /验收|review/i,
    ],
    keywords: ['完成', '修好', 'commit', '提交'],
  },
  {
    skill: 'simplify',
    patterns: [
      /精简|简化|瘦身/i,
      /过度设计|over.?engineer/i,
      /代码.*太.*复杂/i,
    ],
    keywords: ['精简', '简化', '瘦身', 'simplify'],
  },
]

export function matchSkills(input: string): SkillRule[] {
  const inputLower = input.toLowerCase()
  return SKILL_RULES.filter(rule => {
    // 排除条件
    if (rule.excludePatterns?.some(p => p.test(input))) return false
    // 模式匹配
    if (rule.patterns.some(p => p.test(input))) return true
    // 关键词匹配
    if (rule.keywords.some(kw => inputLower.includes(kw))) return true
    return false
  })
}
```

**UI 交互**：

```
┌──────────────────────────────────────────────┐
│ 🎯 检测到相关技能                              │
│                                              │
│ 建议激活: debugging (调试纪律)                 │
│ 描述: 复现→缩小→假设→仪表化→修复→回归测试      │
│                                              │
│ [激活] [跳过] [查看全部技能]                   │
└──────────────────────────────────────────────┘
```

快捷键：
- `Enter` 或 `y` → 激活
- `Esc` 或 `n` → 跳过
- 不提示的情况：已有 activeSkill 时不再建议

---

### 3.4 Phase 3: 多 Skill 组合（未来）

某些场景需要多个 skill 协同：

```
用户："重构这个模块，写好测试，准备 PR"

需要：planning → tdd → verification → finishing-branch
```

**实现思路**：skill 协议栈（stack）

```typescript
interface SkillStack {
  active: Skill[]          // 当前激活的 skill 栈
  push(skill: Skill): void
  pop(): Skill | undefined
  current(): Skill | undefined
}
```

system prompt 注入时，按栈顺序排列：

```markdown
## 当前激活技能栈

1. planning (主) — 控制整体步骤
2. tdd (辅) — 每步遵循 red-green-refactor
```

---

## 4. 改动清单

### Phase 1（立即实施）

| 文件 | 改动 | 复杂度 |
|------|------|--------|
| `packages/skills/loader.ts` | `loadAllSkills` 返回值增加 `triggerHints` 字段 | 低 |
| `packages/skills/types.ts` | `Skill` 接口增加 `triggerHints?: string` | 低 |
| `packages/core/phases/execute/context.ts` | `ExecuteContext` 增加 `availableSkills` | 低 |
| `packages/core/phases/execute/main.ts` | `buildSystem()` 注入 skill 索引 | 中 |
| `packages/core/loop.ts` | `run()` 中传递 availableSkills | 低 |
| `packages/tui/context/loop.tsx` | 传递 availableSkills 到 core loop | 低 |

### Phase 2（后续迭代）

| 文件 | 改动 | 复杂度 |
|------|------|--------|
| `packages/skills/auto-suggest.ts` | 新建：规则匹配引擎 | 中 |
| `packages/tui/context/loop.tsx` | `run()` 中增加自动建议逻辑 | 中 |
| `packages/tui/component/skill-suggest.tsx` | 新建：建议 UI 组件 | 中 |

### Phase 3（远期）

| 文件 | 改动 | 复杂度 |
|------|------|--------|
| `packages/skills/stack.ts` | 新建：skill 栈管理 | 高 |
| `packages/core/phases/execute/main.ts` | 支持多 skill 注入 | 中 |

---

## 5. 与 Claude Code 的兼容性

### 5.1 SKILL.md 格式完全兼容

当前 `.claude/skills/{name}/SKILL.md` 格式不需要任何修改。

### 5.2 增量增强：从 instructions 提取 triggerHints

```typescript
function extractTriggerHints(instructions: string): string {
  // 提取 "## 何时用" 到下一个 "##" 之间的内容
  const match = instructions.match(/## 何时用\n([\s\S]*?)(?=\n##|$)/)
  if (match) {
    return match[1].trim().split('\n')
      .filter(line => line.startsWith('- '))
      .map(line => line.slice(2).trim())
      .join('；')
  }
  return ''
}
```

例如 `tdd` 的 `triggerHints`：

```
实现新功能（哪怕是单文件）；修 bug 后写 regression test；重构前先确保有测试覆盖；用户明确说"用 TDD 做"
```

### 5.3 用户自定义 skill

用户可在 `~/.licode/skills/` 创建自己的 skill，自动被索引和触发。

---

## 6. 风险与对策

| 风险 | 对策 |
|------|------|
| Token 开销增加 | Phase 1 索引控制在 ~300 tokens；Phase 2 只在匹配时注入 |
| 误触发 | Phase 2 用确认机制，用户可拒绝 |
| skill 冲突 | 同一时间只激活一个主 skill（Phase 3 支持栈） |
| 加载性能 | `loadAllSkills()` 结果缓存，session 内只加载一次 |
| SKILL.md 修改后不生效 | 监听文件变化或每次 session 重新加载 |

---

## 7. 验证标准

### Phase 1 验证

- [ ] `bun test packages/skills` 全绿
- [ ] 启动 licode，AI 的 system prompt 中包含可用技能列表
- [ ] AI 在合适场景主动调用 `skill` 工具（如用户说"帮我写测试"时调用 tdd）
- [ ] 不合适场景不调用（如用户问"今天天气"时不触发任何 skill）

### Phase 2 验证

- [ ] 用户输入"帮我 debug 这个 bug" → UI 提示激活 debugging
- [ ] 用户输入"完成了" → UI 提示激活 verification
- [ ] 用户按 Esc → 跳过，正常执行
- [ ] 用户按 Enter → 激活 skill，后续对话遵循 skill 指令

---

## 8. 实施优先级

```
Phase 1 (skill 索引注入)
  ├── 最小改动，立即见效
  ├── AI 自主判断是否调用 skill 工具
  └── 预计工时：0.5 天

Phase 2 (规则自动建议)
  ├── 增加用户确认 UI
  ├── 提高触发准确率
  └── 预计工时：1 天

Phase 3 (多 skill 栈)
  ├── 支持复杂场景
  └── 预计工时：2 天
```

**建议先做 Phase 1**，效果已经很明显：AI 知道有哪些 skill，会在合适时机主动调用。

---

## 9. 附录：工具调用空参数防御

### 9.1 问题描述

LLM 有时会生成空参数的工具调用（如 `write {}`），导致 zod 校验失败。当前代码虽然能捕获错误并返回给 LLM 自我纠正，但错误信息不够友好，LLM 需要额外一轮才能修正。

### 9.2 改进方案

在 `executeToolBatch()` 中增加预校验层：

**改动位置**：`packages/core/phases/execute/main.ts`

```typescript
// 在执行工具前，校验参数完整性
async function executeToolBatch(toolCalls, msgs, subagentManager, ...) {
  const results = await Promise.all(toolCalls.map(async (tc) => {
    const tcInput = tc.input as Record<string, unknown>
    ctx.onToolCall?.(tc.toolName, tcInput, toolBatch)

    let execResult: ToolResult | undefined

    // 新增：空参数预校验
    if (!tcInput || Object.keys(tcInput).length === 0) {
      const toolDef = globalToolRegistry.get(tc.toolName)
      if (toolDef) {
        const schemaHint = zodToJsonSchema(toolDef.inputSchema)
        execResult = {
          success: false,
          error: `工具 "${tc.toolName}" 参数为空。请提供必填参数。\nSchema: ${JSON.stringify(schemaHint)}`,
        }
      }
    }

    // 原有执行逻辑
    if (!execResult) {
      execResult = await globalToolRegistry.execute(tc.toolName, tcInput, { cwd: ctx.cwd })
    }

    // ... 后续处理
  }))
}
```

### 9.3 改进效果

| 改进前 | 改进后 |
|--------|--------|
| `Error: Input validation failed: [{"expected":"string","code":"invalid_type","path":["path"]}]` | `工具 "write" 参数为空。请提供必填参数。Schema: {"type":"object","properties":{"path":{"type":"string"},...},"required":["path","content"]}` |
| LLM 需要猜测 schema 结构 | LLM 直接看到完整 schema，一轮内自我纠正 |

### 9.4 改动清单

| 文件 | 改动 | 复杂度 |
|------|------|--------|
| `packages/core/phases/execute/main.ts` | `executeToolBatch()` 增加空参数预校验 | 低 |

### 9.5 验证标准

- [ ] 空参数调用返回包含 schema 的友好错误
- [ ] LLM 收到错误后一轮内自我纠正成功
- [ ] 正常参数调用不受影响

---

## 10. 代码审查（2026-08-01）

**审查提交**：`2c927c8` (Phase 1) + `13a2ac7` (Phase 2+3)  
**改动量**：11 文件，+482/-3

### 10.1 🔴 必须修复

#### Bug 1：`getSkillIndex()` 重复调用

**文件**：`packages/tui/context/loop.tsx` → `run()`

**问题**：每次用户输入触发 2 次 `loadAllSkills()`（读文件系统），浪费 I/O。

```typescript
// 第一次调用（auto-suggest 阶段，约第 537 行）
const { getSkillIndex } = await import("../../skills/loader")
const availableSkills = await getSkillIndex(process.cwd())

// ... 中间约 20 行代码 ...

// 第二次调用（构建 ctx 阶段，约第 565 行）—— 重复！
const { getSkillIndex } = await import("../../skills/loader")
const availableSkills = await getSkillIndex(process.cwd())
```

**修复**：提取到 `run()` 入口处一次加载，后续复用。

---

#### Bug 2：`SkillSuggest` 组件未接入键盘事件

**文件**：`packages/tui/component/skill-suggest.tsx`

**问题**：`handleKey` 函数定义了但没有绑定到任何键盘事件处理器。用户按 Enter/Esc/↑↓ 不会有任何反应，3 秒后自动超时跳过。

```typescript
export function SkillSuggest(props: SkillSuggestProps) {
  const handleKey = (key: string) => {
    // 定义了键盘处理逻辑...
  }

  return (
    <box ...>
      {/* 渲染了 UI，但 handleKey 从未绑定到任何事件 */}
    </box>
  )
}
```

**修复**：绑定 `onKeyDown` 或类似的键盘事件到组件的 `box` 元素。

---

#### Bug 3：确认逻辑的 Promise 模式类型混乱

**文件**：`packages/tui/context/loop.tsx`

**问题**：`setSkillSuggestResolve` 传入的回调函数参数类型不匹配，语义混乱。虽然运行时碰巧能工作，但难以维护。

```typescript
let skillSuggestResolve: ((value: boolean) => void) | null = null
const setSkillSuggestResolve = (fn) => { skillSuggestResolve = fn }

// run() 中
const confirmed = await new Promise<boolean>((resolve) => {
  const timeout = setTimeout(() => resolve(false), 3000)
  setSkillSuggestResolve((r) => {  // ← r 的类型被推断为 boolean
    clearTimeout(timeout)
    resolve(r)                      // ← 但这里当作参数传给 resolve
    return null
  })
})
```

**修复**：简化为直接赋值模式：

```typescript
const confirmed = await new Promise<boolean>((resolve) => {
  const timeout = setTimeout(() => resolve(false), 3000)
  skillSuggestResolve = (v) => {
    clearTimeout(timeout)
    resolve(v)
    skillSuggestResolve = null
  }
})
```

---

### 10.2 🟡 建议修复

#### Issue 4：缺少测试

两个提交新增 482 行代码，0 个测试文件。

**建议新增**：
```
packages/skills/__tests__/auto-suggest.test.ts   # matchSkills() 纯函数，容易测
packages/skills/__tests__/stack.test.ts          # SkillStack 纯逻辑，容易测
packages/skills/__tests__/loader.test.ts         # 补充 extractTriggerHints() 测试
```

---

#### Issue 5：`inferSkillStack()` 未被调用

**文件**：`packages/skills/stack.ts`

**问题**：`inferSkillStack()` 函数实现了 38 行逻辑，但整个项目没有任何地方调用它。和之前 `findByTrigger()` 同样的问题——定义了但没接入。

**修复**：删除或在 `run()` 中接入调用。

---

#### Issue 6：确认超时 3 秒太短

**文件**：`packages/tui/context/loop.tsx` → `run()`

**问题**：用户看到 Skill 建议后需要阅读描述、决定是否激活、按键确认，3 秒可能不够。

```typescript
const timeout = setTimeout(() => resolve(false), 3000)  // 3 秒
```

**建议**：改为 8-10 秒，或改为不超时（等用户主动操作）。

---

#### Issue 7：`buildSystem()` 中 skillStack 缺少 instructions 注入

**文件**：`packages/core/phases/execute/main.ts`

**问题**：多 skill 栈模式下只注入了 skill 名称和描述，没有注入完整的 instructions。AI 只知道有哪些 skill 激活了，但不知道具体规则，等于没激活。

```typescript
// 多 skill 栈注入
if (ctx.skillStack && ctx.skillStack.length > 0) {
  for (const item of ctx.skillStack) {
    sys += `${i + 1}. ${item.skill.name} (${roleLabel}) — ${item.skill.description}\n`
    // ❌ 没有注入 instructions！
  }
}

// 对比单 skill 模式——注入了完整 instructions
sys += `\n\n## 当前激活技能: ${ctx.activeSkill}\n\n${ctx.activeSkillInstructions}`
```

**修复**：`SkillStackItem` 应包含 `instructions` 字段，或在注入时通过 `findSkill()` 加载完整 instructions。

---

### 10.3 二轮审查（597a4e3）

7 个问题中 6 个已修复，**Bug 2 修复不正确，需要重做**。

| # | 问题 | 状态 |
|---|------|------|
| 1 | getSkillIndex 重复调用 | ✅ 已修复 |
| 2 | SkillSuggest 键盘事件未绑定 | ❌ 修复不正确，见下方 |
| 3 | Promise 模式类型混乱 | ✅ 已修复 |
| 4 | 缺少测试 | ✅ 新增 20 个用例，全部通过 |
| 5 | inferSkillStack() 未被调用 | ✅ 已接入 |
| 6 | 确认超时太短 | ✅ 3s → 10s |
| 7 | skillStack 缺 instructions | ✅ 已修复 |

#### Bug 2 修复不正确（需要重做）

当前修复（597a4e3）：

```typescript
// packages/tui/component/skill-suggest.tsx
const handleKey = (e: any) => {
  const key = typeof e === 'string' ? e : e?.key  // ← 错误：ink 用 e.name 不是 e.key
  ...
}
<box onKeyDown={handleKey}>  // ← 错误：box 不接收键盘事件
```

**问题 1：ink 事件属性名错误**

ink 的键盘事件用 `e.name` 表示按键名称，不是 `e.key`。对比项目中正确的用法：

```typescript
// packages/tui/component/prompt/index.tsx
if (e.name === "up") { ... }    // ✅ 正确
if (e.name === "escape") { ... } // ✅ 正确

// packages/tui/component/skill-suggest.tsx
const key = e?.key               // ❌ 错误：应为 e?.name
```

**问题 2：`box` 组件不支持键盘事件**

ink 框架中，`box` 是纯布局组件，不接收 `onKeyDown`。只有 `textarea` 等可聚焦组件才触发键盘事件。

项目的全局键盘处理都在 `home.tsx` 的 `useKeyboard` hook 中：

```typescript
// packages/tui/routes/home.tsx
useKeyboard((evt) => {
  // 模型选择器的键盘处理
  if (modelPickerOpen()) {
    if (evt.name === "up") { ... }
    if (evt.name === "down") { ... }
    if (evt.name === "return") { ... }
    if (evt.name === "escape") { ... }
  }
  // 斜杠菜单的键盘处理
  if (slashOpen()) {
    if (evt.name === "up") { ... }
    if (evt.name === "down") { ... }
    if (evt.name === "return") { ... }
    if (evt.name === "escape") { ... }
  }
  // ❌ 缺少 pendingSkillSuggestion() 的处理
})
```

**正确修复方案**：

1. `skill-suggest.tsx` 改为纯渲染组件（删除 `handleKey`、删除 `onKeyDown`）
2. 在 `home.tsx` 的 `useKeyboard` 中添加 skill 建议的键盘处理：

```typescript
// packages/tui/routes/home.tsx → useKeyboard()
if (pendingSkillSuggestion()) {
  const skills = pendingSkillSuggestion()!
  if (evt.name === "up") {
    evt.preventDefault()
    // 需要将 selectedIndex 提升到 home.tsx 或用其他方式共享状态
  } else if (evt.name === "down") {
    evt.preventDefault()
  } else if (evt.name === "return" || evt.name === "y") {
    evt.preventDefault()
    const selected = skills[skillSuggestIdx()]
    if (selected) {
      setActiveSkill(selected.name)
      resolveSkillSuggestion(true)
    }
  } else if (evt.name === "escape" || evt.name === "n") {
    evt.preventDefault()
    resolveSkillSuggestion(false)
  }
  return
}
```

注意：`selectedIndex` 状态需要从 `SkillSuggest` 组件提升到 `home.tsx`（或通过 context 共享），因为 `useKeyboard` 和组件不在同一作用域。

### 10.4 审查总结

| 级别 | 数量 | 关键项 |
|------|------|--------|
| 🔴 必须修复 | 1 | SkillSuggest 键盘事件（需重做） |
| 🟡 无 | 0 | 其余 6 个问题已修复 |

**总体评价**：6/7 问题修复质量良好（测试 20 个用例全绿）。剩余 Bug 2 需要理解 ink 框架的事件模型后重做。
