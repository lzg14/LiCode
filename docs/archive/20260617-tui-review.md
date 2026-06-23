# TUI 代码评审报告

**日期**: 2026-06-17
**范围**: `packages/tui/`（7 个文件 + 4 个组件）
**测试方式**: 启动测试 + 模块单元测试（25 项，全部通过）

---

## 1. 启动测试结果

**命令**: `npm start`（`node --import tsx packages/cli/index.ts`）

```
╔═══════════════════════════════════════╗
║         licode - Personal AI          ║
║     "宁可慢，不要白干"                 ║
╚═══════════════════════════════════════╝
[✓] 4 tools loaded
[✓] Imported LLM config from Claude Code
[✓] Config loaded
[✓] Security enabled
[✓] LLM: anthropic / MiniMax-M2.7
[✓] licode 已就绪
输入你的问题，按回车发送。输入 exit 退出。
> [Phase: OBSERVE] ⏳
>
```

**结论**: 启动成功 ✔️ 配置加载成功 ✔️ Claude Code 配置自动导入成功 ✔️

---

## 2. 关键发现

### 2.1 严重: `onInput` 回调未 await 导致竞态条件

**文件**: `packages/tui/components/prompt.ts:22-31`

```typescript
const handler = async () => {
  const input = await this.question('> ')
  if (input.trim()) {
    cb(input)        // ← 没有 await！cb 是 async 函数
  }
  handler()          // ← 立即递归，不等 cb 完成
}
```

**后果**:
1. 第一次输入还在处理 LLM 调用时，用户就可以输入第二次
2. 两个 `onInput` 回调并行执行，各自操作 `state.isProcessing`
3. `state.isProcessing = true` 被第二次回调重写为 false → 状态机混乱
4. UI 层面第二个 `> ` 提示符出现在处理过程中，造成用户困惑

**证据**: 测试输出中 `> [Phase: OBSERVE] ⏳` 后面紧接着又一个 `> `，说明 LLM 调用期间提示符已经重新出现。

### 2.2 严重: dist 产物不可用（ESM 缺少 .js 后缀）

```javascript
// dist/cli/index.js
import { runTUI } from '../tui/app'    // ← 缺少 .js
```

**运行报错**:
```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'D:\ProjectFile\licode\dist\tui\app'
Did you mean to import "../tui/app.js"?
```

`package.json` 的 `"bin"` 指向 `./dist/cli/index.js`，但 TypeScript 编译后不添加 `.js` 后缀，Node.js ESM 无法解析。**所有二进制分发均无法工作**。

**需要修复**: `tsconfig.json` 配置或使用 `tsc-alias`/手动添加 `.js` 后缀。

### 2.3 中等: Config 失败时安全配置不生效

**文件**: `packages/tui/app.ts:54-70`

配置加载失败时走 catch 分支创建默认 config，但 `setSecurityPermission` **只会在 try 块之后执行一次**，且 catch 中的默认 config 不调用 `setSecurityPermission`。

```typescript
catch {
  config = { /* 默认配置，security 字段存在且为空 */ }
}
// 这里 setSecurityPermission 被调用，config 有值
setSecurityPermission({...config.security...})
```

但问题是：`setSecurityPermission` 中 `deniedPaths` 用了 `??` 后备值：
```typescript
deniedPaths: config.security?.deniedPaths ?? ['~', '/home', ...],
```

如果 config 加载失败走 catch，`config.security.deniedPaths` 是 `[]`（非 null/undefined），**`??` 不生效**，最终 `deniedPaths` 是空数组 → 完全没有路径限制。

### 2.4 中等: 提示符在 LLM 调用期间闪烁

**流程**:
1. 用户输入文字
2. `prompt.onInput` 拿到输入，触发 `cb(input)`（未 await）
3. 立即递归调用 `handler()` → 马上打印 `> ` 提示符
4. 此时 LLM 调用可能还在运行（几十秒）
5. 用户看到 `> ` + `[Phase: OBSERVE] ⏳` 同时出现

**问题**: 用户可能误以为程序已空闲，再次输入，造成多个未完成请求堆积。

### 2.5 低: Phase 显示与实际阶段不同步

**文件**: `packages/tui/app.ts:84`

```typescript
bus.emit(TUI_EVENTS.PHASE_CHANGE, 'OBSERVE')
output.printPhase('OBSERVE', true)
```

初始化时手动发射 OBSERVE，但后续 Core Loop 执行时没有发射 PHASE_CHANGE 事件。实际阶段流转（OBSERVE → THINK → PLAN → ...）在 TUI 完全不可见，用户只能看到 `[Phase: OBSERVE] ⏳` 然后突然变为 `[Phase: DONE] ✓`。

**原因**: `core/loop.ts` 的 `executePhase` 不发射任何事件，TUI 无法感知阶段变化。

### 2.6 低: StatusBar 导出但从未使用

**文件**: `packages/tui/components/status.ts`

`renderStatusBar` 函数完整实现（含颜色映射、spinner），但在 `app.ts` 中从未被调用。`output.ts` 的 `printPhase` 是实际使用的渲染方式，两者功能重叠。

### 2.7 低: `exit` 命令处理在 LLM 调用期间不生效

当 LLM 调用阻塞（如 `loop.run()` 正在等待 API 响应），用户输入 `exit` 不会立即退出，因为 `process.exit(0)` 需要等事件循环中的所有 Promise 完成。实际测试中进程 hang 长达 30 秒超时。

---

## 3. 模块测试结果

25 项单元测试全部通过：

| 模块 | 测试项 | 结论 |
|------|--------|------|
| Event Bus | subscribe/emit/unsubscribe/once | ✅ |
| TUI_EVENTS 常量 | 3 个事件常量 | ✅ |
| State | 初始值 + 读写 | ✅ |
| Theme | dark/light 主题 + getTheme | ✅ |
| Storage | set/get/delete/persist | ✅ |
| Phase 模拟 | 3 阶段变化传播 | ✅ |
| 错误传播 | ERROR 事件 | ✅ |
| 组件导入 | Prompt/Output/StatusBar | ✅ |

---

## 4. 代码质量分析

### 4.1 事件驱动架构

**评价**: 设计合理但实现不完整。

| 方面 | 现状 |
|------|------|
| Event Bus | ✅ 正确实现 subscribe/emit/once/unsubscribe |
| Phase Change | ❌ Core Loop 不发射事件，TUI 显示停滞 |
| Tool Call | ⚠️ Tool 系统不发射事件，订阅永不触发 |
| Tool Result | ⚠️ 同上 |
| Bus 类型 | ⚠️ `any[]` 参数类型无类型安全 |

### 4.2 状态管理

**评价**: 简单的单例模式，适合当前规模。

```typescript
export const state: AppState = {
  theme: themes.dark,
  phase: 'OBSERVE',
  currentInput: '',
  isProcessing: false,
  messages: [],
  activeDialog: null,
}
```

**问题**:
- `state.messages` 被定义但从未在 TUI 中使用（app.ts 不添加消息）
- `state.currentInput` 从不更新
- `state.activeDialog` 从不使用
- 所有字段都是 mutable，缺乏响应式机制

### 4.3 潜在卡死问题

1. **LLM 调用期间 UI 卡死**: `loop.run()` 内调用 `ctx.llm.complete()` 是网络 I/O，但没有任何超时保护或进度提示。
2. **Storage JSON 写入失败**: `storage.ts:42` 的 `writeFileSync` 在目录权限不足时静默吞异常，用户不知道数据未保存。
3. **递归无终止条件**: `onInput` 的递归 `handler()` 没有任何退出条件（除非 `rl.close()` 被调用），如果 readline 不触发错误，可能无限递归。

---

## 5. 与 mimo-code TUI 对比

| 特性 | licode TUI 现状 | mimo-code 参考实现 |
|------|----------------|-------------------|
| 批量输入处理 | ❌ 竞态条件 | ✅ 队列串行处理 |
| 阶段实时显示 | ❌ 只显示 OBSERVE | ✅ 7 阶段全显示 |
| LLM 调用进度 | ❌ 纯等待 | ✅ 流式输出 |
| 历史消息 | ❌ 不显示 | ✅ 对话历史可见 |
| 多会话管理 | ❌ 无 | ✅ 会话切换 |
| 颜色主题 | ✅ dark/light | ✅ 多种主题 |
| 退出处理 | ⚠️ exit 命令可用但卡顿 | ✅ 强制退出 |
| 错误显示 | ✅ 控制台打印 | ✅ 通知栏显示 |
| CLI 参数 | ❌ 无 | ✅ 支持参数 |

---

## 6. 改进建议（按优先级）

### P0 - 阻断问题
1. **`prompt.ts:25` 加上 `await cb(input)`** — 解决竞态条件，确保串行处理
2. **`tsconfig.json` 配置 `moduleResolution` + 添加 `.js` 后缀** — 修复 dist 不可用问题

### P1 - 重要
3. **Core Loop 发射 PHASE_CHANGE 事件** — 在 `loop.ts` 的 `executePhase` 中 `bus.emit(PHASE_CHANGE, phase)`
4. **onInput 提示符控制** — 处理中不显示 `> ` 提示符，完成后显示

### P2 - 建议
5. **Config fallback 确保安全默认值生效** — catch 块也调用 `setSecurityPermission`
6. **LLM 调用加超时** — `agent/agent.ts` 的 `timeoutMs` 配置下传到 LLM call
7. **删除未使用的状态字段** — `state.messages`/`currentInput`/`activeDialog` 或用起来

### P3 - 增强
8. **实现 StatusBar 的集成** — `renderStatusBar` 接入 app.ts
9. **存储失败告警** — `storage.ts` 的 catch 块加上 console.warn
10. **添加 CLI 参数支持** — 基本的 `--config` 路径覆盖

---

## 7. 未测试项说明

| 项 | 原因 |
|----|------|
| LLM 实际 API 调用回调处理 | 需要真实 API key 和网络 |
| `output.printBanner` 渲染效果 | 无法程序化验证视觉样式 |
| `prompt.question` 交互流程 | 需要真实 TTY |
