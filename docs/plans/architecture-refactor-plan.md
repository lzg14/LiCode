> ⚠️ **本计划为草稿状态（自 2026-06-20 以来未推进）**
>
> 实施前请重新评估：现状（v0.3.0）的 Core Loop 已简化为单 EXECUTE + VERIFY 阶段，文档中描述的"七阶段硬编码问题"在 `680fb13 feat: Skill 模式补全 + Core Loop 简化 + 类型修复` 中已部分解决。
>
> **推荐做法**：参考 [`docs/plans/production-gaps-2026-q3.md`](./production-gaps-2026-q3.md) 重新规划。

---

# licode 架构重构计划

**版本**: v1.0
**日期**: 2026-06-20
**状态**: 草稿

---

## 1. 背景与目标

### 1.1 现状

licode 目前是一个 Terminal-native AI coding agent，参考了 PAI (Personal AI Infrastructure) 的部分设计理念，但整体架构仍处于初级阶段：

```
当前架构（简化）：

packages/
├── core/        # 核心循环，但依赖过重
├── tui/         # 终端 UI，强耦合
├── tools/       # 工具系统
├── skills/      # Skill 系统（较薄）
├── session/     # 会话管理
├── llm/         # LLM 适配
├── config/      # 配置
└── security/    # 安全层

启动入口：packages/cli/index.ts → tui/app.tsx → CoreLoop
```

### 1.2 问题

| 问题 | 说明 | 影响 |
|------|------|------|
| **Core 依赖过重** | CoreLoop 直接依赖 SessionManager、Memory、CheckpointManager、GitIntegration | 核心不可移植 |
| **UI 强耦合** | app.tsx 直接实例化 CoreLoop | 无法切换不同 UI |
| **Skill 系统较弱** | SkillExecutor 只是返回字符串，没有真正执行 | 难以扩展场景 |
| **最小运行门槛高** | 必须启动完整 TUI 才能使用 | 无法在 minimal 环境运行 |
| **不可扩展 UI** | 没有预留 Web/其他界面的接口 | 未来扩展困难 |

### 1.3 目标

建立 **Core + Adapter + Skill** 的三层架构：

```
┌─────────────────────────────────────────────────────────────┐
│                      愿景架构                                │
│                                                             │
│   ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐      │
│   │ 代码TUI │  │ 音乐TUI │  │ 浏览器  │  │  纯CLI  │      │
│   │ +开发   │  │ +音乐   │  │  +全场景│  │  最小化 │      │
│   │ skill   │  │ skill   │  │  skill  │  │         │      │
│   └───┬─────┘  └───┬─────┘  └───┬─────┘  └───┬─────┘      │
│       │            │            │            │              │
│       └────────────┴─────┬──────┴────────────┘              │
│                         │                                   │
│               ┌─────────▼─────────┐                        │
│               │     Adapter 层     │                        │
│               │  (I/O 适配接口)    │                        │
│               └─────────┬─────────┘                        │
│                         │                                   │
│   ┌─────────────────────┼─────────────────────┐            │
│   │                     │                     │            │
│   │          ┌───────────▼───────────┐        │            │
│   │          │       Core 核心       │        │            │
│   │          │  (最小依赖，极稳定)    │        │            │
│   │          └───────────┬───────────┘        │            │
│   │                      │                    │            │
│   │    ┌─────────────────┼─────────────────┐ │            │
│   │    │                 │                 │ │            │
│   │ ┌──▼──┐  ┌──────┐  ┌─▼────┐  ┌─────┐  │ │            │
│   │ │Skill│  │Skill │  │Skill │  │Skill│  │ │            │
│   │ │代码  │  │音乐  │  │写作  │  │...  │  │ │            │
│   │ │开发  │  │生成  │  │辅助  │  │     │  │ │            │
│   │ └─────┘  └──────┘  └──────┘  └─────┘  │ │            │
│   └─────────────────────────────────────────┘            │
└─────────────────────────────────────────────────────────────┘
```

### 1.4 核心原则

1. **Core 极简**：核心只负责 AI 对话循环，不关心输入输出方式
2. **Adapter 解耦**：任何 UI 只需实现适配器接口即可
3. **Skill 可组合**：Skill 是场景单元，可自由组合
4. **最小依赖**：Core 可以在裸 Bun/Node 环境中运行
5. **向后兼容**：重构不影响现有功能

---

## 2. 目标架构详细设计

### 2.1 目录结构

```
licode/
├── packages/
│   ├── core/                    # 核心包（最小依赖）
│   │   ├── src/
│   │   │   ├── index.ts         # 统一导出
│   │   │   ├── types.ts         # 核心类型定义
│   │   │   ├── adapter.ts       # 适配器接口
│   │   │   ├── loop.ts          # 主循环
│   │   │   ├── skill-host.ts    # Skill 宿主接口
│   │   │   └── message.ts      # 消息格式
│   │   ├── package.json
│   │   └── README.md
│   │
│   ├── adapter-cli/             # CLI 适配器（最基础）
│   │   ├── src/
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── README.md
│   │
│   ├── adapter-tui/             # TUI 适配器（当前）
│   │   ├── src/
│   │   │   └── index.ts         # 重构后
│   │   ├── src/components/      # 现有组件保留
│   │   ├── package.json
│   │   └── README.md
│   │
│   ├── adapter-web/             # Web 适配器（未来）
│   │   ├── src/
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── README.md
│   │
│   ├── skills/                  # Skill 系统（场景无关）
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── types.ts
│   │   │   ├── registry.ts
│   │   │   ├── loader.ts
│   │   │   └── executor.ts
│   │   ├── skills/              # 内置 Skill
│   │   │   ├── code-dev/        # 代码开发
│   │   │   ├── git-workflow/    # Git 工作流
│   │   │   └── test-gen/        # 测试生成
│   │   └── package.json
│   │
│   ├── tools/                   # 工具系统
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── registry.ts
│   │   │   └── builtin/
│   │   └── package.json
│   │
│   ├── llm/                    # LLM 适配（可选，在 adapter 层组装）
│   ├── session/                # 会话管理（可选）
│   ├── memory/                 # 记忆系统（可选）
│   └── security/               # 安全层（可选）
│
├── apps/
│   ├── cli/                    # CLI 应用入口
│   │   ├── src/
│   │   │   └── index.ts        # bun run cli
│   │   └── package.json
│   │
│   ├── tui/                    # TUI 应用入口
│   │   ├── src/
│   │   │   └── index.ts        # bun run tui
│   │   ├── src/components/     # 现有组件
│   │   └── package.json
│   │
│   └── web/                    # Web 应用入口（未来）
│       ├── src/
│       │   └── index.ts
│       └── package.json
│
├── docs/
│   └── plans/
│       └── architecture-refactor-plan.md
│
├── README.md
├── package.json                # workspace root
└── bun.lockb
```

### 2.2 核心接口定义

#### 2.2.1 IAdapter（适配器接口）

```typescript
// packages/core/src/adapter.ts

/**
 * 适配器接口
 * 任何 UI（CLI/TUI/Web/其他）只需实现这个接口即可接入 Core
 */
export interface IAdapter {
  // ===== 输出 =====
  
  /** 输出普通文本（换行） */
  print(text: string): void
  
  /** 流式输出文本（不换行，逐字追加） */
  printStream(text: string): void
  
  /** 输出错误信息 */
  printError(text: string): void
  
  /** 清空当前输出行 */
  clearLine(): void
  
  // ===== 输入 =====
  
  /** 读取用户输入（阻塞等待） */
  readLine(): Promise<string>
  
  // ===== 交互 =====
  
  /** 确认提示（返回 true/false） */
  confirm(message: string): Promise<boolean>
  
  /** 单选提示 */
  select<T>(options: T[], prompt: string): Promise<T>
  
  /** 显示进度条 */
  showProgress?(current: number, total: number, label?: string): void
  
  /** 隐藏进度条 */
  hideProgress?(): void
  
  // ===== 生命周期回调 =====
  
  /** 工具调用时触发 */
  onToolCall?(toolName: string, args: Record<string, unknown>): void
  
  /** 工具结果返回时触发 */
  onToolResult?(toolName: string, result: unknown): void
  
  /** AI 开始思考时触发 */
  onThinking?(): void
  
  /** AI 思考内容输出时触发 */
  onThinkingContent?(content: string): void
  
  /** AI 思考结束时触发 */
  onThinkingEnd?(): void
  
  /** 阶段变化时触发 */
  onPhaseChange?(phase: string): void
}
```

#### 2.2.2 ISkillHost（Skill 宿主接口）

```typescript
// packages/core/src/skill-host.ts

/**
 * Skill 宿主接口
 * Core 通过这个接口为 Skill 提供能力
 */
export interface ISkillHost {
  /** 获取适配器（用于 I/O） */
  getAdapter(): IAdapter
  
  /** 调用 LLM（如果有配置） */
  chat?(messages: Message[], options?: ChatOptions): Promise<string>
  
  /** 调用工具 */
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>
  
  /** 获取配置 */
  getConfig(): CoreConfig
  
  /** 注册生命周期回调 */
  on(event: string, callback: Function): void
  
  /** 触发事件 */
  emit(event: string, ...args: unknown[]): void
}
```

#### 2.2.3 核心类型

```typescript
// packages/core/src/types.ts

/** 消息结构 */
export interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp?: number
}

/** Core 配置 */
export interface CoreConfig {
  /** 工作目录 */
  cwd?: string
  /** LLM 提供者 */
  llm?: {
    provider: 'anthropic' | 'openai' | 'deepseek' | 'minimax'
    model?: string
    apiKey?: string
    baseUrl?: string
  }
  /** Skill 配置 */
  skills?: {
    /** Skill 目录 */
    path?: string
    /** 启用的 Skill 列表 */
    enabled?: string[]
  }
  /** 最大历史消息数 */
  maxHistory?: number
}

/** Skill 定义 */
export interface SkillDefinition {
  name: string
  description: string
  trigger?: string[]
  instructions: string
  sandbox?: 'read' | 'write' | 'exec'
}

/** Skill 执行结果 */
export interface SkillResult {
  success: boolean
  output?: string
  error?: string
}
```

### 2.3 Core Loop 设计

```typescript
// packages/core/src/loop.ts

import type { IAdapter } from './adapter'
import type { ISkillHost } from './skill-host'
import type { CoreConfig, Message, SkillResult } from './types'

export class CoreLoop {
  private messages: Message[] = []
  private running = false
  private host: ISkillHost
  
  constructor(config: CoreConfig) {
    // 核心本身不创建 adapter，由外部传入
  }
  
  /**
   * 设置宿主（adapter + 工具 + LLM）
   */
  setHost(host: ISkillHost): void {
    this.host = host
  }
  
  /**
   * 启动主循环
   */
  async start(): Promise<void> {
    const adapter = this.host.getAdapter()
    this.running = true
    
    adapter.print('licode Core v1.0 - 最小化 AI 对话核心')
    adapter.print('输入 /help 查看命令，输入 /exit 退出\n')
    
    while (this.running) {
      const input = await adapter.readLine()
      
      if (!input.trim()) continue
      
      // 内置命令
      if (input === '/exit' || input === '/quit') {
        this.running = false
        adapter.print('再见！')
        break
      }
      
      if (input === '/help') {
        this.showHelp(adapter)
        continue
      }
      
      if (input === '/clear') {
        this.messages = []
        adapter.clearLine()
        adapter.print('对话历史已清空\n')
        continue
      }
      
      // Skill 命令
      if (input.startsWith('/skill ')) {
        const skillName = input.slice(7).trim()
        await this.executeSkill(skillName)
        continue
      }
      
      // 处理普通输入
      await this.processUserInput(input)
    }
  }
  
  /**
   * 处理用户输入
   */
  private async processUserInput(input: string): Promise<void> {
    const adapter = this.host.getAdapter()
    
    // 添加用户消息
    this.messages.push({
      role: 'user',
      content: input,
      timestamp: Date.now(),
    })
    
    // 如果有 LLM，调用
    if (this.host.chat) {
      adapter.onThinking?.()
      const response = await this.host.chat(this.messages)
      adapter.onThinkingEnd?.()
      
      adapter.printStream(response)
      adapter.print('') // 换行
      
      this.messages.push({
        role: 'assistant',
        content: response,
        timestamp: Date.now(),
      })
    } else {
      // 无 LLM 时，回显
      adapter.print(`[Core] 收到: ${input}`)
    }
  }
  
  /**
   * 执行 Skill
   */
  private async executeSkill(skillName: string): Promise<void> {
    // Skill 执行逻辑
    // ...
  }
  
  /**
   * 显示帮助
   */
  private showHelp(adapter: IAdapter): void {
    adapter.print(`
可用命令：
  /exit, /quit   退出
  /help          显示帮助
  /clear         清空对话历史
  /skill <name>  执行 Skill

直接输入文字开始对话。
    `)
  }
  
  /**
   * 停止主循环
   */
  stop(): void {
    this.running = false
  }
}
```

### 2.4 CLI 适配器实现

```typescript
// packages/adapter-cli/src/index.ts

import type { IAdapter } from '@licode/core'
import { createInterface } from 'readline'

export class CliAdapter implements IAdapter {
  private rl: ReturnType<typeof createInterface> | null = null
  
  print(text: string): void {
    console.log(text)
  }
  
  printStream(text: string): void {
    process.stdout.write(text)
  }
  
  printError(text: string): void {
    console.error(text)
  }
  
  clearLine(): void {
    process.stdout.write('\r\x1b[K')
  }
  
  async readLine(): Promise<string> {
    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    })
    
    return new Promise((resolve) => {
      this.rl!.question('> ', (answer) => {
        this.rl!.close()
        this.rl = null
        resolve(answer)
      })
    })
  }
  
  async confirm(message: string): Promise<boolean> {
    const answer = await this.readLineWithPrompt(`${message} (y/N) `)
    return answer.toLowerCase().startsWith('y')
  }
  
  async select<T>(options: T[], prompt: string): Promise<T> {
    console.log(prompt)
    options.forEach((opt, i) => {
      console.log(`  ${i + 1}. ${String(opt)}`)
    })
    
    const answer = await this.readLineWithPrompt('> ')
    const idx = parseInt(answer) - 1
    return options[idx] ?? options[0]
  }
  
  private readLineWithPrompt(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      })
      
      rl.question(prompt, (answer) => {
        rl.close()
        resolve(answer)
      })
    })
  }
}
```

### 2.5 TUI 适配器设计

```typescript
// packages/adapter-tui/src/index.ts

import type { IAdapter } from '@licode/core'
import type { Accessor, Setter } from 'solid-js'

export interface TuiAdapterOptions {
  output: Accessor<string>
  setOutput: Setter<string>
  appendOutput: (text: string) => void
  error: Accessor<string>
  setError: Setter<string>
  thinking: Accessor<boolean>
  setThinking: Setter<boolean>
  thinkingContent: Accessor<string>
  setThinkingContent: Setter<string>
  readLine: () => Promise<string>
  confirm: (message: string) => Promise<boolean>
  select: <T>(options: T[], prompt: string) => Promise<T>
}

export class TuiAdapter implements IAdapter {
  constructor(private options: TuiAdapterOptions) {}
  
  print(text: string): void {
    this.options.appendOutput(text + '\n')
  }
  
  printStream(text: string): void {
    this.options.appendOutput(text)
  }
  
  printError(text: string): void {
    this.options.setError(text)
  }
  
  clearLine(): void {
    // TUI 中实现清除
  }
  
  readLine(): Promise<string> {
    return this.options.readLine()
  }
  
  confirm(message: string): Promise<boolean> {
    return this.options.confirm(message)
  }
  
  select<T>(options: T[], prompt: string): Promise<T> {
    return this.options.select(options, prompt)
  }
  
  onToolCall?(toolName: string, args: Record<string, unknown>): void {
    // TUI 中显示工具调用
  }
  
  onThinking?(): void {
    this.options.setThinking(true)
    this.options.setThinkingContent('')
  }
  
  onThinkingContent?(content: string): void {
    this.options.setThinkingContent(content)
  }
  
  onThinkingEnd?(): void {
    this.options.setThinking(false)
  }
}
```

---

## 3. 重构步骤

### 阶段一：Core 抽取（1-2 天）

**目标**：创建独立的 core 包，最小依赖

| 步骤 | 内容 | 产出 |
|------|------|------|
| 1.1 | 创建 `packages/core/` 目录结构 | core 包骨架 |
| 1.2 | 定义 `IAdapter` 接口 | adapter.ts |
| 1.3 | 定义 `ISkillHost` 接口 | skill-host.ts |
| 1.4 | 定义核心类型 | types.ts |
| 1.5 | 实现极简 `CoreLoop` | loop.ts |
| 1.6 | 创建统一导出 | index.ts |
| 1.7 | 编写 core 包 README | README.md |

**验收标准**：
- `packages/core/` 可以独立发布为 npm 包
- 没有任何 UI 相关依赖

### 阶段二：CLI 适配器（0.5 天）

**目标**：创建最基础的 CLI 适配器

| 步骤 | 内容 | 产出 |
|------|------|------|
| 2.1 | 创建 `packages/adapter-cli/` | CLI 适配器包 |
| 2.2 | 实现 `CliAdapter` | index.ts |
| 2.3 | 创建 CLI 应用入口 | apps/cli/ |
| 2.4 | 测试 Core + CLI | 可运行的最小版本 |

**验收标准**：
- `bun run cli` 可以启动并响应输入
- 所有交互通过适配器完成

### 阶段三：TUI 适配器（1-2 天）

**目标**：将现有 TUI 重构为适配器

| 步骤 | 内容 | 产出 |
|------|------|------|
| 3.1 | 创建 `packages/adapter-tui/` | TUI 适配器包 |
| 3.2 | 抽取现有 TUI 中的适配逻辑 | TuiAdapter |
| 3.3 | 保持现有 UI 组件不变 | components/ |
| 3.4 | 重构 `tui/app.tsx` 使用适配器 | 重构完成 |
| 3.5 | 创建 TUI 应用入口 | apps/tui/ |

**验收标准**：
- TUI 功能完全保留
- `app.tsx` 不再直接创建 CoreLoop
- 通过适配器连接 Core 和 UI

### 阶段四：Skill 系统增强（2-3 天）

**目标**：让 Skill 系统真正工作

| 步骤 | 内容 | 产出 |
|------|------|------|
| 4.1 | 增强 Skill 类型定义 | types.ts |
| 4.2 | 实现 Skill 加载器 | loader.ts |
| 4.3 | 实现 Skill 执行器 | executor.ts |
| 4.4 | 创建基础 Skill 示例 | skills/code-dev/ |
| 4.5 | 实现 Skill 与 Core 的集成 | skill-host.ts |
| 4.6 | 热加载支持 | hot-reload.ts |

**验收标准**：
- Skill 可以被加载和执行
- Skill 可以调用工具
- Skill 之间可组合

### 阶段五：清理与文档（1 天）

**目标**：整理代码，编写文档

| 步骤 | 内容 | 产出 |
|------|------|------|
| 5.1 | 清理冗余代码 | 无用文件删除 |
| 5.2 | 更新根 README | 架构说明 |
| 5.3 | 编写开发者文档 | docs/ |
| 5.4 | 更新 package.json workspace 配置 | package.json |

---

## 4. 迁移策略

### 4.1 逐步迁移

```
第1步：Core 独立 → 不影响现有代码
    │
    ▼
第2步：CLI 适配器 → 可以运行 cli
    │
    ▼
第3步：TUI 适配器 → TUI 功能保持
    │
    ▼
第4步：Skill 增强 → 功能扩展
```

### 4.2 回滚方案

每个阶段完成后，当前代码仍然可用：

| 阶段 | 旧代码 | 新代码 |
|------|--------|--------|
| 1 | `packages/core/` (混在) | `packages/core/` (独立) |
| 2 | `packages/tui/` (直接调用) | `packages/adapter-tui/` |
| 3 | `packages/cli/` (简单) | `apps/cli/` (完整) |

### 4.3 测试策略

```bash
# 1. Core 单元测试
bun test packages/core/

# 2. CLI 适配器测试
bun test packages/adapter-cli/

# 3. TUI 适配器测试
bun test packages/adapter-tui/

# 4. 集成测试
bun test apps/cli/
bun test apps/tui/
```

---

## 5. 风险与应对

| 风险 | 影响 | 应对 |
|------|------|------|
| 重构范围过大 | 可能引入 bug | 分阶段实施，每阶段验证 |
| 适配器接口设计不当 | 未来扩展困难 | 参考成熟方案（Node.js stream 等） |
| Skill 系统复杂 | 实现周期长 | 先实现最小可用版本 |
| TUI 重构破坏现有功能 | 用户体验下降 | 保留原有入口，逐步迁移 |

---

## 6. 工作量估算

| 阶段 | 预计时间 | 说明 |
|------|----------|------|
| 阶段一：Core 抽取 | 1-2 天 | 核心接口和类型定义 |
| 阶段二：CLI 适配器 | 0.5 天 | 简单实现 |
| 阶段三：TUI 适配器 | 1-2 天 | UI 组件保持不变 |
| 阶段四：Skill 增强 | 2-3 天 | Skill 真正工作 |
| 阶段五：清理文档 | 1 天 | 文档完善 |
| **总计** | **5.5-8.5 天** | |

---

## 7. 附录

### A. 接口设计参考

- Node.js `readline` 接口
- Rust `trait` 模式
- Go `interface{}` 模式
- 前端 `Adapter` 模式

### B. 相关文档

- [PAI 架构文档](../reference/pai-architecture.md)
- [licode 当前架构](.)
- [Skill 系统设计](../modules/skills.md)

---

## 更新日志

| 版本 | 日期 | 修改内容 |
|------|------|----------|
| v1.0 | 2026-06-20 | 初稿 |
