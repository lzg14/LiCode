> ⚠️ **本文档已过期（2026-06-22 启动 / 2026-07-22 被取代）**
>
> 已被 [`production-gaps-2026-q3.md`](../production-gaps-2026-q3.md) 取代。
>
> 完整归档说明参见：[`docs/plans/archive/README.md`](./README.md)

# 下一阶段改进计划

**目标**：在当前 sprint（streaming + slash-tab）完成后，进入下一阶段改进，**优先填 P0 测试覆盖**，再做 P1 体验/健壮性改进，P2 视情况。

**日期**：2026-06-22
**前置**：streaming + slash-tab 已实施；commit 历史见 `git log --oneline -5`

---

## 改进全景

| # | 方向 | 估时 | 优先级 | 阶段 |
|---|------|------|--------|------|
| 1 | **核心路径测试覆盖** | 1 天 | **P0** | 阶段一 |
| 2 | **LLM 错误恢复增强** | 半天 | P1 | 阶段二 |
| 3 | **配置错误友好反馈** | 2 小时 | P1 | 阶段二 |
| 4 | **Silent Failure 排查** | 2 小时 | P1 | 阶段二 |
| 5 | **TUI 长消息展开/折叠** | 半天 | P1 | 阶段三 |
| 6 | Token 用量 UI 展示 | 2 小时 | P2 | 阶段四 |
| 7 | 压缩完成通知 | 2 小时 | P2 | 阶段四 |
| 8 | Dev-Logger 日志查询 | 半天 | P2 | 阶段四 |

**总投入**：约 **5 天**集中开发

---

## 阶段一：P0 测试覆盖（最重要）

> 没有这一步，所有未来改动都是高空走钢丝。execute.ts 是 500+ 行的核心循环，loop.ts 也是，agent 刚改的 streamText 逻辑 0 保护。

### 1.1 execute.ts 核心函数测试

**目标**：覆盖 execute.ts 的纯函数和可测部分

**涉及文件**：
- `packages/core/phases/__tests__/execute-helpers.test.ts`（新建）

**待测函数**（从 execute.ts 提取或直接测）：

| 函数 | 测试点 |
|---|---|
| `findValidStart(messages)` | 边界：空历史、只有 user、orphan tool-result、孤立 tool-call、正常配对 |
| `loadProjectConfig(cwd)` | 已存在缓存 / 新 dir / 全局+项目合并 / 向上搜索 |
| tool result 构造 | 成功/失败路径、security error 透传 |

**典型 case**：
```ts
// findValidStart 边界
it('空历史 → 0', () => { ... })
it('单 user → 0', () => { ... })
it('user + assistant + tool-result（无 tool-call）→ 1', () => { ... })
it('user + assistant (tool-call) + tool-result + user → 3', () => { ... })
it('user + assistant (tool-call) → 0（孤立）', () => { ... })
```

**估时**：4 小时  
**verify**：`bun test packages/core/phases` 全过，execute-helpers.test.ts ≥ 12 个 case

### 1.2 loop.ts 关键函数测试

**目标**：覆盖 session 恢复、消息去重、checkpoint 流程

**涉及文件**：
- `packages/core/__tests__/loop-helpers.test.ts`（新建）

**待测函数**：

| 函数 | 测试点 |
|---|---|
| `searchSessionMessages()` | 命中 / 不命中 / 多匹配 |
| `compactSession()` | 阈值触发 / LLM 精炼失败 / 备份 |
| checkpoint restore 逻辑 | 文件存在 / 损坏 / 跨 session 恢复 |

**估时**：3 小时  
**verify**：≥ 10 个 case

### 1.3 端到端 smoke test

**目标**：用一个 mock LLM 跑完整 execute 循环，验证消息流不丢

**涉及文件**：
- `packages/core/__tests__/execute-e2e.test.ts`（新建）

**典型 case**：
- mock LLM 第一次返回 tool_call，第二次返回文本
- 验证：messages 累积正确、tool 结果回填、最终文本回到 caller

**估时**：1 小时  
**verify**：3 个 e2e case

### 阶段一验收
- [ ] execute-helpers.test.ts ≥ 12 case
- [ ] loop-helpers.test.ts ≥ 10 case
- [ ] execute-e2e.test.ts ≥ 3 case
- [ ] `bun test` 全过
- [ ] 覆盖率报告（`bun test --coverage`）core 包 > 60%

---

## 阶段二：P1 健壮性改进

### 2.1 LLM 错误恢复增强

**痛点**：当前 provider 失败时直接 `continue` 下一个，没有区分错误类型；401/429/500 行为一样。

**现状**（`packages/llm/provider.ts:47-54`）：
```ts
} catch (e) {
  console.warn(`Provider ${p} failed: ${e}`)
  continue
}
```

**改进方案**：

1. 新增 `packages/llm/retry-strategy.ts`：
   ```ts
   export type RetryStrategy = {
     shouldRetry: (error: Error) => boolean
     delayMs: (attempt: number) => number
   }
   
   const strategies: Record<string, RetryStrategy> = {
     // 401：立即失败，不重试
     auth: { shouldRetry: () => false, delayMs: () => 0 },
     // 429：指数退避
     rateLimit: { shouldRetry: () => true, delayMs: (n) => 2 ** n * 1000 },
     // 5xx：指数退避
     server: { shouldRetry: () => true, delayMs: (n) => Math.min(2 ** n, 30) * 1000 },
     // 网络错误：重试 3 次
     network: { shouldRetry: () => true, delayMs: (n) => (n + 1) * 1000 },
   }
   ```

2. 错误信息友好化：
   - 401 → `"API Key 无效或已过期，请检查 ${envVarName} 环境变量"`
   - 429 → `"API 限流（${retryAfter}秒后重试）"`
   - 5xx → `"Provider 服务暂时不可用"`

**涉及文件**：
- `packages/llm/retry-strategy.ts`（新建）
- `packages/llm/provider.ts`（改用 strategy）
- `packages/llm/__tests__/retry-strategy.test.ts`（新建）

**估时**：半天  
**verify**：
- [ ] retry-strategy.test.ts ≥ 8 case
- [ ] 错误信息友好化测试
- [ ] 现有测试无回归

### 2.2 配置错误友好反馈

**痛点**：配置写错时，错误信息是 Zod 技术报错（如 `Expected "anthropic", received "deepseek"`），不友好。

**现状**（`packages/config/validator.ts:36-41`）：直接 Zod 错误透传

**改进方案**：

1. 新增 `formatConfigError(zodError, schema)` 函数：
   ```ts
   export function formatConfigError(err: z.ZodError): string {
     return err.issues.map(issue => {
       const path = issue.path.join('.')
       switch (issue.code) {
         case 'invalid_enum_value':
           return `配置错误 [${path}]: 必须是以下之一: ${issue.options.join(', ')}\n  实际值: ${JSON.stringify(issue.received)}`
         case 'invalid_type':
           return `配置错误 [${path}]: 期望 ${issue.expected}, 实际 ${issue.received}`
         case 'unrecognized_keys':
           return `配置错误: 未知字段 ${issue.keys.join(', ')}`
         default:
           return `配置错误 [${path}]: ${issue.message}`
       }
     }).join('\n')
   }
   ```

2. `loadConfig()` 失败时调用此函数输出

3. 添加常见错误示例链接到 `licode.config.json.example`

**涉及文件**：
- `packages/config/format-error.ts`（新建）
- `packages/config/validator.ts`（改用 format）
- `packages/config/__tests__/format-error.test.ts`（新建）

**估时**：2 小时  
**verify**：
- [ ] format-error.test.ts ≥ 6 case
- [ ] 实际启动一个错配的 config 看到友好提示

### 2.3 Silent Failure 排查

**痛点**：多处 `catch(e) {}` 或 `catch(e) { debug(...) }` 导致问题静默丢失。

**现状（已发现）**：
- `packages/core/loop.ts:87-89` Git 连接失败静默
- `packages/core/loop.ts:261-263` memory store 失败静默
- `packages/session/session-compactor.ts:110-112` LLM 精炼失败静默
- `packages/tools/builtin.ts` 部分工具错误没展示

**改进方案**：

1. **统一 silent failure 策略**：
   - 不影响主流程的 → 升级到 `devLogger.warn`，**永远不静默**
   - 用户应该知道的 → 升级到 TUI toast 或状态栏图标
   - 内部清理性的 → 保持 debug 级别

2. **新增 `SilentFailure` 列表文档**（`docs/silent-failures.md`）：
   - 列出每处 `catch` 块
   - 标注当前级别（silent/warn/error/visible）
   - 标注是否需要改为 visible

3. **TUI 状态栏加"健康状态"指示器**：
   - 黄色图标：当前有 warning 级错误被 swallow
   - 鼠标悬停：列出最近 5 个 warning

**涉及文件**：
- `packages/core/loop.ts`（改 catch 块）
- `packages/session/session-compactor.ts`（改 catch 块）
- `packages/tools/builtin.ts`（错误展示）
- `packages/tui/component/status-bar.tsx`（加健康状态）
- `docs/silent-failures.md`（新建清单）

**估时**：2 小时  
**verify**：
- [ ] grep `catch.*{}` 无匹配（除明确保留的）
- [ ] 故意触发一个原 silent 的失败，看是否在 TUI 可见

---

## 阶段三：P1 TUI 体验改进

### 3.1 长消息展开/折叠

**痛点**：用户粘贴长代码或长报错，消息列表撑爆布局，滚动很久。

**现状**：`message-list.tsx:139-141` 只对 bash 命令做了 `length > 50` 截断；assistant 的 diff 展示完全没截断。

**改进方案**：

1. 抽通用 `<CollapsibleText>` 组件：
   ```tsx
   <CollapsibleText
     content={text}
     maxLines={10}
     collapsedHeight={3}
   />
   ```
   - 默认折叠
   - 鼠标点击或按 `Enter` 展开
   - 展开时显示行数：`(10/20 行，点击展开)`

2. 应用到：
   - assistant 消息（> 10 行折叠）
   - bash 输出（已有 `> 50` 截断改为统一组件）
   - tool 结果（按行数）

**涉及文件**：
- `packages/tui/component/collapsible-text.tsx`（新建）
- `packages/tui/component/message-list.tsx`（替换内联截断）
- `packages/tui/__tests__/collapsible-text.test.ts`（新建）

**估时**：半天  
**verify**：
- [ ] collapsible-text.test.ts ≥ 5 case
- [ ] 手动测试：长 diff 自动折叠，点击展开

---

## 阶段四：P2 体验增强（可选）

### 4.1 Token 用量 UI 展示

**痛点**：开发者想估算花了多少钱，没直观展示。

**现状**：`cost.ts` 有完整计算，但 TUI 不显示。

**方案**：状态栏右侧加 `↑1.2K ↓3.4K $0.023` 格式

**估时**：2 小时

### 4.2 压缩完成通知

**痛点**：用户不知道什么时候触发压缩，压缩后节省多少无感知。

**方案**：压缩完成后 TUI 显示 `已压缩 N 条历史，保留最近 M 条` 通知

**估时**：2 小时

### 4.3 Dev-Logger 日志查询

**痛点**：dev-logger 写日志，cat 全文找问题。

**方案**：
- 日志文件按 sessionId 命名
- 提供 `bun run logs [sessionId] [--level=ERROR]` 命令

**估时**：半天

---

## 不做什么

| 项 | 原因 |
|---|---|
| 重写整个 LLM 抽象 | 现有 provider 抽象够用，只需加 strategy 层 |
| 引入状态管理库（zustand 等） | SolidJS signals 已经够用 |
| 加新功能 | 这一轮专注改进现有功能 |
| 重做 TUI 主题系统 | 现有主题够用 |
| 多窗口/multi-tab TUI | 个人使用不需要 |

---

## 执行模式

| 阶段 | 模式 | 备注 |
|---|---|---|
| 阶段一 | 串行 agent（一个 agent 跑完整个测试套件） | 测试高度相关 |
| 阶段二 | 可并行（2.1/2.2/2.3 独立） | 各自 1 个 agent |
| 阶段三 | 单 agent | 一个功能一个 agent |
| 阶段四 | 手动 | 选感兴趣的做 |

**建议节奏**：
- 阶段一：1 天（最重要）
- 阶段二：1-1.5 天（可分 2-3 个 agent 并行）
- 阶段三：0.5 天
- 阶段四：按需

---

## 验收标准

完成后：

1. ✅ 核心路径覆盖率 > 60%
2. ✅ 配置错误有友好中文提示
3. ✅ LLM 错误按类型智能重试
4. ✅ 无静默失败（grep `catch.*{}` 零匹配）
5. ✅ TUI 长消息自动折叠
6. ✅ Token 用量 + 费用展示
7. ✅ 压缩通知
8. ✅ Dev-Logger 可按 session 查询

---

## 风险

| 风险 | 缓解 |
|---|---|
| 测试需要 mock LLM 真实行为 | 已有 mock provider，扩展示例 |
| 阶段二多 agent 并行可能冲突 | 各自改不同文件，无交集 |
| 折叠组件可能与现有 scrollbox 冲突 | 先在 message-list 中找相似组件复用 |
| 重构 silent failure 可能引入 regression | 每处都跑测试，保留原 catch 注释 |

---

## 决策点

### 决策 1：测试框架用 vitest 还是 bun:test？

**选 vitest**（项目现用）。`bun test` 也能跑 vitest 写的测试。**统一一个**。

### 决策 2：错误信息用中文还是英文？

**选中文**。CLI 错误用户都是中文用户。System prompt 也是中文的。

### 决策 3：折叠组件是用纯 TUI 组件还是引入 react-collapsed 类似库？

**选自建**。opentui 已有 `scrollbox` 组件，自建一个简单的 maxLines 控制就够了，避免引入新依赖。

### 决策 4：阶段四是否真的要做？

**选做 1-2 个**。P2 不是必须的，按用户兴趣选。**建议做 #1（Token 用量）和 #2（压缩通知）**。

---

## 工作量总计

| 阶段 | 估时 |
|---|---|
| 阶段一 | 1 天 |
| 阶段二 | 1-1.5 天 |
| 阶段三 | 0.5 天 |
| 阶段四 | 0.5-1 天 |
| **合计** | **3-4 天** |

---

## 与现有 sprint 的衔接

```
当前 sprint:
  [done] cleanup-and-docs-plan.md → 已提交
  [doing] streaming-chunked-display.md → agent 跑
  [doing] slash-tab-fix.md → agent 跑

下一 sprint (本文档):
  [next] 阶段一：核心路径测试（最高优先）
  [next] 阶段二：健壮性三件套
  [next] 阶段三：TUI 折叠
  [next] 阶段四：P2 体验增强
```

---

确认后发给 agent。先做阶段一（测试覆盖）。
