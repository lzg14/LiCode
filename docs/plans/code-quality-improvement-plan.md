# licode 代码质量提升计划

**目标**：系统性提升代码质量 — 清理死代码、修复类型安全、补充关键测试、拆分大文件、同步文档
**日期**：2026-07-31

## 前置

- 基于 4 个并行扫描 agent 的结果（core/TUI/infra/docs）
- 与 `production-gaps-2026-q3.md` 互补，不重复
- 本计划聚焦**可立即落地的改进**，不涉及新功能

---

## 现状总结

### 按严重度排序

| 严重度 | 类别 | 数量 | 关键区域 |
|---|---|---|---|
| 🔴 高 | `any` 类型泛滥 | ~40+ | `session-compactor`, `subagent`, `execute/main`, `query-builder` |
| 🔴 高 | 测试覆盖极低 | ~57 文件无测试 | `tools/builtin/*`（39 工具仅 2 测试文件）、TUI 组件（22 文件无测试） |
| 🔴 高 | 大文件（God File） | 4 个 | `loop.tsx`(897行)、`home.tsx`(448行)、`prompt/index.tsx`(448行)、`builtin.ts`(914行) |
| 🟡 中 | 死代码 | 6 处 | `KeybindProvider`/`DialogProvider` 全未使用、`_MAX_VISIBLE_TOOLS`、`copy` 别名、`Route.session` 变体 |
| 🟡 中 | 性能问题 | 5 处 | 同步 I/O 阻塞事件循环、`findById()` O(n) 扫描、`Timer.end()` O(n) 查找 |
| 🟡 中 | 错误吞没 | 9 处 | `detect-project`、`session/memory`、`skills/loader` 中 `catch {}` |
| 🟡 中 | 响应式缺陷 | 5 处 | `MessageItem` 内 props 在 tracking scope 外读取、Spinner 不动画、全局 signal |
| 🟡 中 | 文档与实现脱节 | 8 处 | CHANGELOG 缺最近 6 个提交、README 缺 intelligence/hardware/subagent 文档 |
| 🟡 中 | 基础设施问题 | 5 处 | `.gitignore` 拼写错误、CHANGELOG 重复条目、无 `clean` 脚本、`xlsx` 未懒加载、`test_api.js` 未忽略 |
| 🟢 低 | 代码重复 | 3 处 | `MarkdownText`/`MarkdownTextInline` 重复、`parseImageRefs` 测试重复、SQL builder 重复 |
| 🟢 低 | 未使用变量 | 2 处 | `_latestVersion`、`_duration` |

---

## 步骤

### Step 1：清理死代码 + 基础设施修复

**文件**：多个

删除以下完全未使用的代码：

1. `packages/tui/context/keybind.tsx` — `KeybindProvider`/`useKeybind` 无任何消费者
2. `packages/tui/ui/dialog.tsx` — `DialogProvider`/`useDialog` 无任何消费者
3. `packages/tui/app.tsx` — 移除 `KeybindProvider` 和 `DialogProvider` 的 provider 包裹
4. `packages/tui/context/route.tsx` — 删除 `Route` 类型的 `{ type: "session" }` 变体
5. `packages/tui/component/message-list.tsx` — 删除 `_MAX_VISIBLE_TOOLS` 常量
6. `packages/tui/util/clipboard.ts` — 删除 `copy` 别名导出
7. `packages/core/session-compactor.ts` — 删除 `_latestVersion` 变量
8. `packages/core/loop.ts` — 删除 `_duration` 变量
9. `packages/llm/cost.ts` — 删除 `calculateCost()` 和 `formatCost()`（无消费者）

修复基础设施问题：

10. `.gitignore` — 修复拼写错误：`/.mimicode/` → `/.mimocode/`（当前目录 `.mimocode/` 未被忽略）
11. `.gitignore` — 添加 `test_api.js` 到忽略列表
12. `package.json` — 添加 `"clean": "rm -rf dist"` 脚本
13. 项目根目录 — 删除 11 个散落的日志文件（`all-test.log`、`cache-test.log`、`render.log`、`tsc-*.log` 等）
14. `packages/tui/` — 删除 `err.log` 和 `out.log`

- verify: `bunx tsc --noEmit --skipLibCheck` 编译通过；`bun test` 全部通过

---

### Step 2：修复 Spinner 动画

**文件**：`packages/tui/component/spinner.tsx`

当前 Spinner 定义了 10 帧动画但只渲染 `frames[0]`，永远不动画。添加 `setInterval` 循环切换帧：

```tsx
export function Spinner(props: { children?: JSX.Element }) {
  const { textMuted } = useTheme()
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
  const [frameIdx, setFrameIdx] = createSignal(0)

  onMount(() => {
    const id = setInterval(() => setFrameIdx(i => (i + 1) % frames.length), 80)
    onCleanup(() => clearInterval(id))
  })

  return (
    <box flexDirection="row">
      <text fg={textMuted()}>{frames[frameIdx()]}</text>
      <text> {props.children}</text>
    </box>
  )
}
```

- verify: `bun run dev` 启动后看到 Spinner 动画旋转

---

### Step 3：修复 ToastProvider 内存泄漏

**文件**：`packages/tui/ui/toast.tsx`

添加 `onCleanup` 清理 `timeoutHandle`：

```ts
onCleanup(() => {
  if (timeoutHandle) {
    clearTimeout(timeoutHandle)
    timeoutHandle = null
  }
})
```

- verify: `bunx tsc --noEmit --skipLibCheck` 编译通过

---

### Step 4：修复响应式缺陷 — MessageItem 内部计算

**文件**：`packages/tui/component/message-list.tsx`

`MessageItem` 内 `stripSystemTags`、`deriveThinkingDisplay`、`lineCount` 等计算在组件顶层直接执行，不在 tracking scope 内。用 `createMemo` 包裹：

```tsx
function MessageItem(props: { msg: Message; syntaxStyle?: SyntaxStyle }) {
  const { primary, text, textMuted, error, success, warning, info } = useTheme()

  if (props.msg.role === "assistant") {
    const cleaned = createMemo(() => stripSystemTags(props.msg.content))
    const display = createMemo(() => deriveThinkingDisplay(cleaned(), true))
    const lineCount = createMemo(() => props.msg.content.split('\n').length)
    // ...
  }
}
```

**注意**：SolidJS 的 `createMemo` 不能在条件分支内调用（违反 hooks 规则）。需要把 `assistant`/`tool`/`system` 各角色拆成独立组件，或在组件顶层用 `createMemo` + 条件渲染。

- verify: `bunx tsc --noEmit --skipLibCheck` 编译通过；手动测试消息列表渲染正常

---

### Step 5：修复核心包 `any` 类型（最高 ROI 的 5 个文件）

**文件**：`packages/core/subagent.ts`、`packages/core/session-compactor.ts`、`packages/core/phases/execute/main.ts`、`packages/session/helpers.ts`、`packages/tools/types.ts`

每个文件逐一替换 `any` 为具体类型：

1. **`subagent.ts`**：定义 `SpawnContext` 接口替代 `model: any` / `messages: any[]`；`toolCalls` 用 AI SDK 的 `ToolCall` 类型
2. **`session-compactor.ts`**：`messages` 参数用 `ModelMessage[]`（AI SDK 类型）；`llm.complete` 用 `LLMCompleteFn` 接口
3. **`execute/main.ts`**：`LLMResult.usage` 用 `{ inputTokens: number; outputTokens: number; totalTokens: number }`；`streamError` 用 `unknown` + 类型守卫
4. **`helpers.ts`**：`rowToMessage`/`rowToPart` 用 `Record<string, unknown>` + 字段验证
5. **`tools/types.ts`**：`handler` 的 `input` 用 `unknown` + zod 验证（已在运行时验证）

- verify: `bunx tsc --noEmit --skipLibCheck` 编译通过；`bun test` 全部通过

---

### Step 6：修复错误吞没 — 添加日志

**文件**：9 处 `catch {}`

把所有空的 `catch {}` 改为 `catch (e) { devLogger.debug(...) }` 或 `catch (e) { logger.warn(...) }`，确保错误可追踪：

1. `packages/core/detect-project.ts:67` — `catch (e) { devLogger.debug('DETECT', 'detectRuntimes failed', e) }`
2. `packages/core/detect-project.ts:86` — `catch (e) { devLogger.debug('DETECT', 'detectFramework failed', e) }`
3. `packages/session/memory.ts:55,101,126` — `catch (e) { devLogger.debug('MEMORY', '...') }`
4. `packages/skills/loader.ts:94,123` — `catch (e) { devLogger.debug('SKILL', '...') }`
5. `packages/tools/builtin/elevated.ts:115,119` — `catch (e) { /* proc.kill() 失败可忽略 */ }`（保留注释说明原因）

- verify: `bunx tsc --noEmit --skipLibCheck` 编译通过

---

### Step 7：同步 CHANGELOG 和 README

**文件**：`CHANGELOG.md`、`README.md`

1. **CHANGELOG**：在 `## [Unreleased]` 下添加最近 6 个提交的条目：
   - 内存泄漏和闪烁修复
   - Anthropic API baseUrl /v1 后缀修复
   - callLLM streamResult 泄漏修复
   - slash menu 模糊搜索
   - pending text 防抖
   - QueueMessages 截断修复

2. **README**：
   - 测试框架从 "Vitest" 改为 "bun test"
   - 添加 intelligence 模块说明
   - 添加 hardware-adaptive 配置说明
   - 添加 `/loop` 命令完整语法
   - 添加 subagent 状态显示说明
   - 添加 SECURITY.md 链接

- verify: 手动检查 README 与实际功能一致

---

### Step 8：补充关键工具测试（第一批 5 个）

**文件**：`packages/tools/__tests__/`

39 个工具仅 2 个测试文件，优先补充最高频使用的 5 个：

1. `read.test.ts` — 测试读取文件、读取不存在的文件、路径穿越拦截
2. `write.test.ts` — 测试写入文件、路径穿越拦截
3. `edit.test.ts` — 测试编辑文件、old_string 不匹配、路径穿越拦截
4. `bash.test.ts` — 测试命令白名单、危险命令拦截、超时
5. `grep.test.ts` — 测试搜索模式、glob 过滤、无匹配

- verify: `bun test packages/tools` 新增 5 个测试文件通过

---

### Step 9：修复性能问题 — 同步 I/O 改异步

**文件**：`packages/core/session-compactor.ts`、`packages/session/memory.ts`、`packages/skills/loader.ts`

1. **`session-compactor.ts`**：`writeFileSync`/`readFileSync` 改为 `writeFile`/`readFile`（async）
2. **`session/memory.ts`**：`readdirSync`/`readFileSync`/`statSync` 改为 async 版本
3. **`skills/loader.ts`**：`readdirSync`/`readFileSync` 改为 async 版本（函数已是 `async`，但内部用的同步 I/O）

- verify: `bunx tsc --noEmit --skipLibCheck` 编译通过；`bun test` 全部通过

---

### Step 10：归档已完成的计划文档

**文件**：`docs/plans/`

1. `codebase-scan-fixes-plan.md` — 已完成 → 移到 `archive/`
2. `architecture-refactor-plan.md` — 已过时（7 阶段问题已修） → 移到 `archive/`
3. `tui-memory-leak-and-flicker-fix.md` — 更新为已完成状态（Step 1-8 全部 DONE + 审查 #1-#6 已修）

- verify: `docs/plans/` 目录下只剩活跃计划

---

## 不做什么

| ❌ | 原因 |
|---|---|
| LoopProvider 拆分 | 是大重构，风险高，需要独立计划和充分测试 |
| StreamStore 数据分离 | `tui-render-optimization.md` 的长期方案，单独做 |
| Project detector | 新功能，不属于代码质量提升 |
| Actor model L3 | 新功能，7-9 天工作量 |
| 全部 `any` 消除 | ~40+ 处，本计划只做最高 ROI 的 5 个文件 |
| 全部测试补充 | 57 文件无测试，本计划只做最高频的 5 个工具 |
| 视口虚拟化 | 仅长会话有意义，优先级低 |

---

## 执行顺序

```
Step 1 (死代码清理) ← 最安全，先上
  ↓
Step 2 (Spinner 动画) ← 独立，可并行
Step 3 (Toast 泄漏)  ← 独立，可并行
Step 7 (CHANGELOG/README) ← 独立，可并行
Step 10 (归档计划) ← 独立，可并行
  ↓
Step 6 (错误吞没) ← 简单，可并行
  ↓
Step 4 (响应式缺陷) ← 需要仔细测试
Step 5 (any 类型) ← 需要仔细测试
  ↓
Step 8 (工具测试) ← 独立，可并行
Step 9 (同步 I/O) ← 需要仔细测试
```

**并行策略**：Step 1/2/3/7/10 可并行执行；Step 4/5/6 可并行；Step 8/9 可并行

---

## 验收标准

- [ ] `bunx tsc --noEmit --skipLibCheck` 编译通过
- [ ] `bun test` 全部通过（排除已知 flaky test）
- [ ] 死代码完全删除（`grep -r "KeybindProvider\|DialogProvider\|_MAX_VISIBLE_TOOLS\|Route.*session" packages/` 0 结果）
- [ ] Spinner 动画正常工作
- [ ] CHANGELOG 包含最近所有提交
- [ ] README 与实际功能一致
- [ ] 新增 5 个工具测试文件

---

## 相关文档

- [docs/plans/production-gaps-2026-q3.md](./production-gaps-2026-q3.md) — 生产差距评估
- [docs/plans/tui-memory-leak-and-flicker-fix.md](./tui-memory-leak-and-flicker-fix.md) — 内存泄漏修复（已完成）
- [docs/plans/tui-render-optimization.md](./tui-render-optimization.md) — StreamStore 长期方案（未实施）
