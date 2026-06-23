# licode 开发路线图

> ⚠️ **本文档部分已过期（2026-07-22 状态更新）**
>
> "已完成"区描述的是 **2026-06-20 当天状态**，现已远超：
> - Core Loop：七阶段已删除（2026-06-21 `refactor: 清理死代码`），现为单 EXECUTE 阶段
> - Tools：27→**34 个**（新增 Excel / image / database / windows 工具）
> - LLM：3→**4 个** provider（+MiniMax）
> - Session：30/100 条压缩阈值（不是 200 条/100K token）
>
> "半成品"区**全部已完成**：
> - ✅ Plan Review 阶段已删除（随七阶段一起砍）
> - ✅ Security 接线：`packages/tools/registry.ts` 的 `preExecuteHook`
> - ✅ 并发队列：loop.tsx 串行
> - ✅ TUI 首次启动闪烁：app.tsx 已有 setTimeout 兜底
>
> **阶段一~五大部分完成**，剩余真实差距见 [`production-gaps-2026-q3.md`](./production-gaps-2026-q3.md)。

---

**版本**: v0.2.0
**日期**: 2026-06-20（2026-07-22 标记部分过期）

---

## 当前状态

### ✅ 已完成的

| 模块 | 内容 |
|---|---|
| Core Loop | 七阶段流水线（OBSERVE→THINK→PLAN→BUILD→EXECUTE→VERIFY→LEARN）全部填上逻辑 |
| Session | SQLite 持久化、跨启动恢复、历史压缩（200条/100K token 触发）、子 agent 异步精炼 |
| Tools | 27 个工具：文件操作、搜索、系统、Git、Web、Excel、数据库、补丁、技能 |
| TUI | 对话列表、输入框、侧栏（Stats/Context/Progress）、模型切换、斜杠命令菜单、快捷键 |
| Config | 多层级（全局/项目/环境变量）、外部导入（Claude Code） |
| LLM | Anthropic / OpenAI / DeepSeek 支持，运行时模型切换 |
| 清理 | 死代码清理、垃圾文档删除、`.gitignore` 完善 |
| 修复 | 中间文本重复、侧栏闪屏、路径 `~` 展开、东八区时间 |

### ⚠️ 半成品

| 模块 | 问题 | 优先级 |
|---|---|---|
| Plan Review | `triggerReview()` 永远返回 approved，E3+ 审核形同虚设 | P0 |
| Security | whitelist/permissions 没接线到 execute.ts，LLM 可执行任意命令 | P0 |
| 并发队列 | `pendingCount`/`inputQueue` 定义了但没真正串行，快速输入会乱 | P1 |
| TUI 终端重排 | 首次启动布局错乱（`handleResize` 未生效） | P1 |

### ❌ 死代码（写了但没用）

| 模块 | 文件数 | 建议 |
|---|---|---|
| `packages/agent/` | 9 个文件 | 保留骨架，标注「未集成到 Core Loop」 |
| `packages/snapshot/` | 2 个文件 | 保留，供将来 Diff 预览使用 |
| `packages/question/` | 2 个文件 | 保留，供 Interview 阶段使用 |
| `packages/server/` | 6 个文件 | 保留，HTTP API 可能有用 |
| `packages/plugin/` | 3 个文件 | 保留 |
| `packages/worktree/` | 1 个文件 | 保留 |
| `packages/integration/database.ts` | 1 个文件 | 保留 |
| `packages/integration/notes-*.ts` | 2 个文件 | 保留 |

---

## 阶段一：修核心缺陷（P0）

> 目标：让核心功能跑对，不骗自己

### 1.1 修复 Plan Review

**问题**：`plan-review.ts` 的 `triggerReview()` 永远返回 `{ approved: true, issues: [] }`

**方案**：改为调用 LLM 做真实评审，或者至少做本地规则检查

**涉及文件**：`packages/core/phases/plan-review.ts`

**改动量**：~60 行

### 1.2 Security 接线

**问题**：`bash` 工具没有经过任何权限检查

**方案**：在 `toolRegistry.execute()` 中添加 security 拦截，检查命令白名单

**涉及文件**：
- `packages/tools/registry.ts` — 执行前调 security check
- `packages/security/index.ts` — 暴露 `checkCommand()` 函数

**改动量**：~40 行

### 1.3 修复 TUI 首次启动布局

**问题**：`handleResize` 在 Windows 上可能不触发

**方案**：改用 `onResize` 事件 + 延迟重排，或 `useTerminalDimensions()`

**涉及文件**：`packages/tui/app.tsx`

**改动量**：~10 行

---

## 阶段二：清理死代码（P1）

> 目标：减少认知负担，让代码量反映实际功能

### 2.1 标记未用模块

不在代码中删除，而是在 README 中标注：

| 模块 | 标注 |
|---|---|
| `packages/agent/` | ⚠️ 骨架已完成，未集成到 Core Loop |
| `packages/snapshot/` | ⏸️ 预留，供 Diff 预览使用 |
| `packages/question/` | ⏸️ 预留，供 Interview 阶段使用 |
| `packages/server/` | ⏸️ 预留，HTTP API |
| `packages/plugin/` | ⏸️ 预留，插件系统 |
| `packages/worktree/` | ⏸️ 预留，工作树管理 |

**涉及文件**：`README.md`

**改动量**：~20 行

### 2.2 可选的彻底删除

如果确定不要，删掉：
- `packages/audit/` — 日志写到文件但没人看，可移除
- `packages/integration/database.ts` — 不需要独立 DatabaseIntegration
- `packages/integration/notes-*.ts` — Obsidian 集成不必要

---

## 阶段三：增强已有功能（P1）

> 目标：让现有功能更好用

### 3.1 并发请求队列

**问题**：快速连续输入多条消息，会同时发起多个 `run()`

**方案**：把 `LoopProvider.run()` 改成串行执行，后面的请求排队

**涉及文件**：`packages/tui/context/loop.tsx`

**改动量**：~30 行

### 3.2 模型切换快捷显示

**问题**：`Ctrl+M` 打开选择器 → `↑↓` 选择 → `Enter` 确认，但看不到当前模型

**方案**：侧栏已显示，Alt+M 直接 /model 上个/下个模型（快捷键循环）

**涉及文件**：`packages/tui/routes/home.tsx`

**改动量**：~15 行

### 3.3 斜杠命令补全

**问题**：`/` 菜单已经实现，但 `/skill` 的子命令补全没做

**方案**：输入 `/skill ` 后列出可用技能

**涉及文件**：`packages/tui/routes/home.tsx`

**改动量**：~20 行

---

## 阶段四：新功能（P2）

> 目标：让 licode 真正有用

### 4.1 自动回退（VERIFY 失败 → EXECUTE）

**问题**：VERIFY 发现测试失败，返回 `{ phase: 'EXECUTE' }`，但 LLM 不知道要改什么

**方案**：把测试失败的输出注入到下一轮 EXECUTE 的上下文中

**涉及文件**：`packages/core/phases/verify.ts`、`packages/core/loop.ts`

**改动量**：~40 行

### 4.2 上下文窗口警告

**方案**：侧栏显示 model context window 最大容量，当前用量超过 80% 时警告

**涉及文件**：`packages/tui/component/sidebar.tsx`、`packages/llm/catalog.ts`

**改动量**：~30 行

### 4.3 `/save` / `/load` 会话

**方案**：手动保存当前会话到命名文件，加载指定会话

**涉及文件**：`packages/tui/routes/home.tsx`、`packages/session/session.ts`

**改动量**：~50 行

### 4.4 Diff 预览

**问题**：改代码前用户看不到具体改了什么

**方案**：在 EXECUTE 阶段生成 unified diff，在 TUI 中展示

**涉及文件**：`packages/tui/component/message-list.tsx`、`packages/core/phases/execute.ts`

**改动量**：~80 行

### 4.5 TUI 文件树

**方案**：左侧新增文件树面板，可浏览项目文件，按 Enter 读取

**涉及文件**：`packages/tui/component/file-tree.tsx`（新建）

**改动量**：~150 行

---

## 阶段五：长远规划（P3）

> 目标：让 licode 与众不同

### 5.1 Skill 驱动阶段

**方案**：每个阶段的行为由 skill 文件定义，不从代码硬编码

### 5.2 MCP 工具集成

**方案**：注册 MCP 服务器提供的动态工具

### 5.3 截图/视觉分析

**方案**：截图工具 + 多模态 LLM 分析

### 5.4 语义搜索

**方案**：向量嵌入 + 语义记忆搜索

---

## 时间估算

| 阶段 | 预估工作量 | 优先级 |
|---|---|---|
| 阶段一：修核心缺陷 | 半天 | **马上做** |
| 阶段二：清理死代码 | 1 小时 | 下一个 |
| 阶段三：增强功能 | 1 天 | 之后 |
| 阶段四：新功能 | 2-3 天 | 再之后 |
| 阶段五：长远规划 | 待定 | 先不急 |

---

## 总结

```
现在最该搞的：
1. Plan Review 真实评审    ← 半天
2. Security 接线           ← 半天
3. 并发请求队列            ← 半天
```

这 3 个做完后 licode 就"不会骗自己"了——E3+ 真正审核、命令真正受限、快速输入不乱。
