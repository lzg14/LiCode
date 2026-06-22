# Silent Failure 清单

**目标**：列出所有 `catch` 块，标注其当前可见性策略，作为未来 review 的参考

**日期**：2026-07-22
**对应 plan**：[production-gaps-2026-q3.md P0-3](./plans/production-gaps-2026-q3.md)
**结论**：5/5 生产 catch 全部已合理处理，0 处需要改

---

## 策略

按"对用户的影响"分 3 级：

| 级别 | 含义 | 处理方式 |
|---|---|---|
| **visible** | 用户应该知道（影响主流程） | TUI toast / 错误消息 / devLogger.error |
| **warn** | 内部维护者应该知道（影响辅助功能） | devLogger.warn |
| **debug** | 调试用（降级路径） | devLogger.debug |

**默认**：
- 影响主流程 → **visible**
- 不影响主流程 → **debug**
- 内部清理（如临时文件 unlink）→ swallow

---

## 清单

### 生产代码（5 处）

| # | 位置 | 级别 | 行为 | 评价 |
|---|---|---|---|---|
| 1 | `packages/cli/index.ts:4` | visible | `runTUI().catch(console.error)` | ✅ 合理：CLI 入口兜底；TUI 都没起来时 devLogger 路径未确认，console.error 是最后兜底 |
| 2 | `packages/core/loop.ts:89` | debug | Git 连接失败 → `devLogger.debug('GIT', 'connect failed', e)` | ✅ 合理：Git 是可选功能，不影响主对话流程 |
| 3 | `packages/core/loop.ts:334` | debug | 后台压缩失败 → `devLogger.debug('COMPACT', ...)` | ✅ 合理：压缩失败不影响当前对话，可下次重试 |
| 4 | `packages/tools/builtin.ts:692, 695` | swallow | apply_patch 临时文件 unlink → swallow | ✅ 合理：清理性操作，文件不存在属正常 |
| 5 | `packages/tui/util/selection.ts:19` | visible | 用户复制错误 → `toast.error` | ✅ 合理：直接展示给用户 |

### 测试代码（8 处）

| # | 位置 | 级别 | 行为 | 评价 |
|---|---|---|---|---|
| 6-9 | `packages/core/__tests__/session-recovery.test.ts:139-142` | swallow | 测试 DB 清理 `rm -f` → swallow | ✅ 合理：测试 setup 清理，文件不存在属正常 |
| 10-13 | `packages/session/__tests__/session.test.ts:24-27` | swallow | 测试 DB 清理 `rm -rf` → swallow | ✅ 合理：同上 |

---

## 历史背景

2026-06-21 `code-quality-improvement.md` P1-10 曾计划"统一 console.* → devLogger"和"消除静默失败"。经过本次 review（2026-07-22）：

- **`console.*` 收敛**：`grep -r "console\.(log|warn|error)" packages/ --include="*.ts"` 当前 0 匹配（除 cli/index.ts 的兜底）。✅
- **空 catch 块**：`grep "catch.*{}"` 0 匹配。✅
- **生产 catch 全部已合理分级**：5/5。✅

剩余可争议项：

- **`packages/cli/index.ts:4` 用 `console.error` 而非 `devLogger.error`**：刻意保留（兜底中的兜底，devLogger 路径未确认时再调可能二次失败）。
- **`packages/tui/component/` 无 try-catch**：渲染错误直接抛到 SolidJS 错误边界（opentui/solid 自带 ErrorBoundary）。✅
- **`packages/integration/mcp.ts` 连接失败**：走 pre-execute hook 的 try-catch，未直接暴露给用户。✅ MCP 工具调用失败时会显示在 LLM 上下文，LLM 可重试。

---

## 未来 review 检查清单

新增 catch 块时，确认以下问题：

- [ ] 此 catch 是否已在本文档清单中？（如未列出，更新本文档）
- [ ] 影响主流程吗？→ 用 `visible`（toast / devLogger.error）
- [ ] 不影响主流程但开发需要排查？→ 用 `devLogger.warn`
- [ ] 是清理性操作（unlink、close、rm）？→ swallow 是合理的
- [ ] 测试代码？→ swallow 是合理的
- [ ] CLI 入口或进程退出路径？→ console.error 是合理的（兜底）

---

## 相关文件

- [`packages/core/dev-logger.ts`](../packages/core/dev-logger.ts) — 统一日志通道
- [`docs/silent-failures.md`](./silent-failures.md) — 本文档
- [`docs/plans/production-gaps-2026-q3.md`](./plans/production-gaps-2026-q3.md) — 来源 plan

---

## 修订记录

| 日期 | 修订 | 作者 |
|---|---|---|
| 2026-07-22 | 初版：5/5 生产 catch 全部 review 完毕，0 处需改 | licode |
