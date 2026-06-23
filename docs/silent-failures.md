# Silent Failure 清单

**目标**：列出所有 `catch` 块，标注其当前可见性策略，作为未来 review 的参考

**日期**：2026-06-17（更新）
**对应 plan**：[production-gaps-2026-q3.md P0-3](./plans/production-gaps-2026-q3.md)、[code-quality-improvement.md](./plans/code-quality-improvement.md)
**结论**：所有生产 catch 均已合理分级；文档与实际一致

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

### 生产代码（8 处）

| # | 位置 | 级别 | 行为 | 评价 |
|---|---|---|---|---|
| 1 | `packages/session/memory.ts:57,108,136` | swallow | 文件读取/无权限跳过 → 带注释 swallow | ✅ 合理：各有简短注释说明原因 |
| 2 | `packages/tools/builtin.ts:60` | swallow | write_file 读取旧内容 → 文件不存在时新建 | ✅ 合理：有注释说明场景 |
| 3 | `packages/tools/builtin.ts:496` | swallow | bingRedirect URL 解码失败 → 使用原始 href | ✅ 合理：有注释说明降级 |
| 4 | `packages/tools/builtin.ts:707` | swallow | apply_patch JSON Patch 尝试失败 → 试 unified diff | ✅ 合理：有注释说明继续尝试其他格式 |
| 5 | `packages/tools/builtin.ts:894` | swallow | get_clipboard_image Win 无图片 | ✅ 合理：有注释 |
| 6 | `packages/tools/builtin.ts:906,907` | swallow | get_clipboard_image macOS 无图片 / 临时清理 | ✅ 合理：有注释 |
| 7 | `packages/tools/builtin.ts:917` | swallow | get_clipboard_image Linux xclip 未安装或非图片 | ✅ 合理：有注释 |
| 8 | `packages/tools/builtin.ts:692,695` | swallow | apply_patch 临时文件 unlink → swallow | ✅ 合理：清理性操作，文件不存在属正常 |

### 生产代码（原始记录，不含新补充的行号）

| # | 位置 | 级别 | 行为 | 评价 |
|---|---|---|---|---|
| a | `packages/cli/index.ts:4` | visible | `runTUI().catch(console.error)` | ✅ 合理：CLI 入口兜底；TUI 都没起来时 devLogger 路径未确认，console.error 是最后兜底 |
| b | `packages/core/loop.ts:89` | debug | Git 连接失败 → `devLogger.debug('GIT', 'connect failed', e)` | ✅ 合理：Git 是可选功能，不影响主对话流程 |
| c | `packages/core/loop.ts:334` | debug | 后台压缩失败 → `devLogger.debug('COMPACT', ...)` | ✅ 合理：压缩失败不影响当前对话，可下次重试 |
| d | `packages/tui/util/selection.ts:19` | visible | 用户复制错误 → `toast.error` | ✅ 合理：直接展示给用户 |

### 测试代码（8 处）

| # | 位置 | 级别 | 行为 | 评价 |
|---|---|---|---|---|
| 6-9 | `packages/core/__tests__/session-recovery.test.ts:139-142` | swallow | 测试 DB 清理 `rm -f` → swallow | ✅ 合理：测试 setup 清理，文件不存在属正常 |
| 10-13 | `packages/session/__tests__/session.test.ts:24-27` | swallow | 测试 DB 清理 `rm -rf` → swallow | ✅ 合理：同上 |

---

## 历史背景

2026-06-21 `code-quality-improvement.md` P1-10 曾计划"统一 console.* → devLogger"和"消除静默失败"。经过本次 review（2026-06-17）：

- **`console.*` 收敛**：`grep -r "console\.(log|warn|error)" packages/ --include="*.ts"` 当前仅 cli/index.ts（兜底）、cli/logs.ts（CLI 日志查看器）、core/dev-logger.ts（日志实现自身）保留 console 调用。✅
- **空 catch 块**：`grep "catch.*{}"` 仅测试代码 1 处（`packages/core/__tests__/execute-e2e.test.ts:31`）。✅
- **生产 catch 全部已合理分级**：8 处全部带注释。✅

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
| 2026-06-17 | 更新：新增 8 处生产 catch 清单 + console.* 收敛 + scope bug 修复 + reasoning 类型处理 | licode |
