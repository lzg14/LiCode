# 已完成 / 过期实施计划归档

> 本目录存放**已完成、过期或被取代**的 `plans/` 实施计划。
>
> **当前活跃的计划**请参见 [`../README.md`](../../README.md) → "实施计划"。

---

## 归档规则

`plans/` 下的文件移入 `archive/` 的条件（满足任一）：

1. **已完成**：所有 TODO 项已勾选，commit hash 已标注
2. **已过期**：被新计划完整替代（如 `roadmap.md` → `production-gaps-2026-q3.md`）
3. **已搁置**：短期内不实施（如 `headroom-integration-plan.md` 因复杂度被搁置）
4. **元计划完成**：`cleanup-and-docs-plan` 这类一次性整理计划已执行完毕

---

## 完成情况汇总

| 状态 | 数量 | 说明 |
|------|------|------|
| ✅ 已完成 | 8 | 全部 TODO 完成，结果已合入主分支 |
| 🔧 大部分完成 | 3 | 主体功能已上线，剩余小项可独立追踪 |
| ❌ 已搁置 | 4 | 短期内不实施，保留作为决策记录 |
| 📋 已过期（被取代） | 5 | 被新计划替代，原文档保留作为历史 |

---

## 目录内容（按主题分类）

### 1. 流式输出与显示

| 文档 | 日期 | 状态 | 备注 |
|------|------|------|------|
| [streaming-chunked-display.md](./streaming-chunked-display.md) | 2026-06-22 | ✅ 完成 | thinking/系统提示分块渐进展示 |
| [scroll-smooth-and-thinking-flash.md](./scroll-smooth-and-thinking-flash.md) | 2026-06 | ✅ 完成 | MessageList 滚动卡顿 + Thinking 切换闪烁 |
| [thinking-display-refactor.md](./thinking-display-refactor.md) | 2026-06-21 | 🔧 大部分完成 | 3 状态 → 纯函数 + 单测；曾 patch 3 次仍未稳定，**遗留问题**：见活跃计划 |
| [fix-intermediate-text-duplication.md](./fix-intermediate-text-duplication.md) | 2026-06 | ✅ 完成 | 修复 LLM 工具调用循环中中间文本与最终回复重复 |

### 2. Slash 菜单与快捷键

| 文档 | 日期 | 状态 | 备注 |
|------|------|------|------|
| [slash-menu-simplification.md](./slash-menu-simplification.md) | 2026-06-21 | ✅ 完成 | `/` 菜单精简 + 新增 `/clear` |
| [slash-tab-fix.md](./slash-tab-fix.md) | 2026-06-22 | ✅ 完成 | Tab 把选中命令填入输入框，Enter 走 `handleSlashSubmit` |
| [prompt-shortcuts.md](./prompt-shortcuts.md) | 2026-06-21 | ✅ 完成 | 输入框完整快捷键（光标、选择、剪贴板等） |
| [help-command.md](./help-command.md) | 2026-06-21 | 🔧 大部分完成 | `/help` 列出所有快捷键；按类别组织 |

### 3. 安全与可观测性

| 文档 | 日期 | 状态 | 备注 |
|------|------|------|------|
| [security-config-wiring.md](./security-config-wiring.md) | 2026-06-21 | ✅ 完成 | `licode.config.json` 的 `security.*` 字段真正生效 |
| [security-test-coverage.md](./security-test-coverage.md) | 2026-06-21 | ✅ 完成 | 补 `factory.test.ts` 关键模式（合并 / PowerShell 黑白名单 / 配置联动） |
| [dev-logger-redact.md](./dev-logger-redact.md) | 2026-06-21 | ✅ 完成 | 阻止 API key / token / 密码写入 `~/.licode/logs/dev/` |

### 4. Skills / 外部集成

| 文档 | 日期 | 状态 | 备注 |
|------|------|------|------|
| [claude-code-skills-integration.md](./claude-code-skills-integration.md) | 2026-06-21 | ✅ 完成 | 直接消费 `~/.claude/skills/` 下的 SKILL.md（commit `7357b00`） |
| [headroom-integration-plan.md](./headroom-integration-plan.md) | 2026-06-21 | ❌ 搁置 | 复杂度高（Python 子进程 + 6 个压缩算法、15-20 天）；当前压缩方案（`session-compactor.ts` + LLM 总结 + `truncate.ts`）已够用 |

### 5. LLM / Session

| 文档 | 日期 | 状态 | 备注 |
|------|------|------|------|
| [compact-llm-summary.md](./compact-llm-summary.md) | 2026-06-22 | ✅ 完成 | `/compact` 改为 LLM 总结为主 |

### 6. 元计划与路线图

| 文档 | 日期 | 状态 | 备注 |
|------|------|------|------|
| [cleanup-and-docs-plan.md](./cleanup-and-docs-plan.md) | 2026-06-21 | ✅ 完成 | 删死代码、修 CHANGELOG/README、版本号统一 0.2.0 |
| [code-quality-improvement.md](./code-quality-improvement.md) | 2026-06-21 | 🔧 大部分完成 | 8 项 P0 全部完成（tsc 0 错误、provider 类型统一、LICENSE/CI 待补 — 已在 Q3 计划中追踪） |
| [productization-plan.md](./productization-plan.md) | 2026-06-21 | 🔧 85% 完成 | 5 阶段产品化；剩余 15% 见活跃计划 |
| [next-improvements.md](./next-improvements.md) | 2026-06-22 | 📋 已过期 | 已被 [production-gaps-2026-q3.md](../production-gaps-2026-q3.md) 取代 |
| [roadmap.md](./roadmap.md) | 2026-06 | 📋 已过期 | 旧版路线图（描述的是 2026-06-20 当天状态） |
| [workflow-system.md](./workflow-system.md) | 2026-06-20 | ❌ 搁置 | 早期 Workflow 系统设计 v0.1.0；未实施 |

---

## 相关链接

- 活跃计划 [`../README.md`](../../README.md) → "实施计划"
- 活跃评估 [`../production-gaps-2026-q3.md`](../production-gaps-2026-q3.md)
- 已废弃设计 [`../../archive/README.md`](../../archive/README.md)
