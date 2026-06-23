# licode 产品化计划

> ⚠️ **本文档大部分已完成（2026-07-22 状态更新）**
>
> **5 阶段产品化完成度：~85%**
>
> | 阶段 | 状态 | 说明 |
> |---|---|---|
> | 阶段零：清理工作区 | ✅ | 七阶段 phase 文件已删，home.tsx 修改已提交 |
> | 阶段一：P0 缺陷修复 | ✅ | 安全层 + todo + 危险命令拦截全部就位 |
> | 阶段二：体验增强 | ✅ | Diff 预览 + 工具结果截断完成 |
> | 阶段三：上下文管理 | ✅ | .licode.md 加载 + 上下文窗口预警 |
> | 阶段四：MCP 生态 | ✅ | mcp.ts + mcp-server.ts + mcp-tools.ts |
> | 阶段五：Workflow 简化 | ✅ | workflow/ 已删，system prompt 模板化 |
> | 阶段六：测试与文档 | ⚠️ | README/CHANGELOG 已更新；测试覆盖仍在补 |
>
> **剩余真实差距**（不再按 5 阶段拆解）见 [`production-gaps-2026-q3.md`](./production-gaps-2026-q3.md)：CI/CD、LICENSE、tools/llm/tui 组件测试、memory scope、extended thinking 等。

---

**目标**：把 licode 从"学习项目"提升到"可用产品" — 补齐 P0 安全/规划缺陷，叠加 P1 体验增强

**日期**：2026-06-21  
**基于**：[roadmap.md](./roadmap.md) + [workflow-system.md](./workflow-system.md) + 实测代码分析

---

## 阶段零：清理工作区（前置）

> 工作区有 8 个未提交的 phase 文件删除 + home.tsx 修改，先处理掉再开始正式开发

- [ ] **Step 0.1**：审查未提交的 diff 范围
  - verify: `git diff --stat` 显示 9 个文件，未引入新逻辑（仅删除和样式调整）
- [ ] **Step 0.2**：把删除提交为一个原子提交 `chore: 移除已废弃的七阶段 phase 文件`
  - verify: `git log --oneline -1` 显示新提交；`packages/core/phases/` 只剩 `execute.ts`
- [ ] **Step 0.3**：把 `home.tsx` 修改单独提交（如果是样式/UI 调整）
  - verify: `git status` 干净；`git log --oneline -2` 显示两次提交

---

## 阶段一：P0 缺陷修复（核心安全 + 规划能力）

> 没有这两块，licode 是"演示玩具"；做了这两块，才能算"可用工具"

### 1.1 安全层接入工具执行

**问题**：`bash` 工具无任何权限校验，LLM 可执行任意命令；`apply_patch`/`write` 无路径边界

- [ ] **Step 1.1.1**：在 `packages/tools/registry.ts` 增加 pre-execute hook
  - verify: 跑 `bun test packages/tools/__tests__/` 全过；测试用例：注册一个会 throw 的 hook，所有工具调用都被拦截
- [ ] **Step 1.2.1**：实现 `security.checkCommand(command: string): { allowed: boolean; reason?: string }`
  - verify: 单元测试覆盖 — 白名单匹配、危险命令（rm -rf /、curl | sh）拒绝、空白绕过检测
- [ ] **Step 1.2.2**：把 hook 接到 `globalToolRegistry.execute()`，bash 工具走白名单校验
  - verify: 在 TUI 中让 LLM 调 `bash("rm -rf /")` → 显示拒绝原因；调 `bash("ls")` → 通过
- [ ] **Step 1.2.3**：把 hook 接到 `write`/`edit`/`delete_file`，检查路径不在 `deniedPaths`（.git/.env/.ssh）
  - verify: 让 LLM 尝试写 `~/.ssh/id_rsa` → 拒绝；写 `./test.txt` → 通过
- [ ] **Step 1.2.4**：在 `licode.config.json.example` 补充示例（deniedPaths 默认值）
  - verify: 文件存在且包含 `.git`、`.env`、`.ssh`

### 1.2 规划工具（替代七阶段的核心缺失）

**问题**：砍掉七阶段后没有 todo 系统，LLM 跨工具调用无法追踪进度，快速输入必乱

- [ ] **Step 1.3.1**：实现 `todo_write(input: { items: Array<{id, content, status, activeForm?}> })` 工具
  - verify: 单元测试覆盖状态转换（pending→in_progress→completed/cancelled）；重复 id 报错
- [ ] **Step 1.3.2**：实现 `todo_read()` 工具，返回当前 todos
  - verify: 单测：write 后 read 返回一致；空 todo 返回 `[]`
- [ ] **Step 1.3.3**：在 `system prompt` 加入规划引导 — "复杂任务（>3 步）请先 todo_write"
  - verify: 启动 TUI 看 system prompt；测试一个 5 步任务，LLM 是否主动写 todo
- [ ] **Step 1.3.4**：TUI 侧栏渲染 todos（status 图标 + content，截断到 N 项）
  - verify: 启动 TUI，让 LLM 写 todos，侧栏实时显示；status 变化时刷新

### 1.3 危险命令二次确认

- [ ] **Step 1.4.1**：定义 `DANGEROUS_PATTERNS`（rm -rf、curl | sh、sudo、chmod 777 等）
  - verify: 单元测试覆盖 8+ 种危险模式；正常命令不被误判
- [ ] **Step 1.4.2**：工具执行前弹 Dialog（复用 `tui/ui/dialog`），允许/拒绝/始终允许
  - verify: TUI 中调 `bash("rm -rf ./tmp")` → 弹确认框；选择拒绝 → 工具返回 `{success: false, error: "用户拒绝"}`

---

## 阶段二：体验增强（Diff 预览 + 编辑体验）

> 没有 diff 预览，用户不敢让 LLM 改文件；这是从"玩具"到"工具"的关键体感

### 2.1 文件编辑前 Diff 预览

- [ ] **Step 2.1.1**：`edit`/`write`/`apply_patch` 工具返回 `{ diff?: string, pending?: boolean }`
  - verify: 单元测试 — 调用 edit 工具，result.diff 包含 unified diff 格式（+/- 行）
- [ ] **Step 2.1.2**：TUI 在工具执行前显示 diff（如果非空）并询问 "应用此变更？"
  - verify: TUI 中调 edit 工具，看到 diff 渲染（颜色区分 +/-）；按 y 应用，n 取消
- [ ] **Step 2.1.3**：session 持久化 "已应用 diff 列表"，可在状态栏查看
  - verify: 改 3 个文件，状态栏显示 "已改 3 个文件"；hover 显示文件列表

### 2.2 工具结果截断（解决上下文爆炸）

- [ ] **Step 2.2.1**：扩展 `packages/tools/truncate.ts`，支持按 token 数截断（用 `gpt-tokenizer` 或简单字数估算）
  - verify: 单测：输入 10KB 文本，限制 2000 token，输出 < 2000 token，附"[已截断，原始 N tokens]"
- [ ] **Step 2.2.2**：grep/read/bash 输出 > 阈值时自动截断
  - verify: 在 TUI 跑 `grep(".*", "**/*.ts")`，结果超长时工具返回带截断标记的内容

---

## 阶段三：上下文管理（项目级记忆 + 窗口预警）

> 生产 Agent 的核心竞争力是"记得住"

### 3.1 项目级 CLAUDE.md 加载

- [ ] **Step 3.1.1**：启动时从 cwd 向上找 `.licode.md` / `LICODE.md`，读取注入 system prompt
  - verify: 在测试目录创建 `.licode.md` 内容"项目用 bun"；启动 TUI 问"用什么包管理" → LLM 答 bun
- [ ] **Step 3.1.2**：支持 `global`（~/.licode/CLAUDE.md）和 `project` 两级合并，project 优先
  - verify: 全局写"全局规则"，项目写"项目规则"；问"规则" → 合并返回

### 3.2 上下文窗口预警

- [ ] **Step 3.2.1**：从 `llm/catalog.ts` 拿模型 context window（如 sonnet-4 = 200K）
  - verify: catalog 已有数据；新增 `getContextWindow(modelId)` 函数
- [ ] **Step 3.2.2**：侧栏 "Context" 面板显示当前用量百分比，>80% 黄、>95% 红
  - verify: 跑长对话，触发压缩前侧栏变黄；触发压缩后变绿

---

## 阶段四：生态（MCP 接入）

> 不支持 MCP = 2026 年的 AI Agent 不算完整

- [ ] **Step 4.1**：实现 `packages/integration/mcp.ts` — 从 config 读 mcpServers 配置，连接 MCP servers
  - verify: 配置 `mcpServers.filesystem` 指向官方 filesystem server；启动 TUI，工具列表包含 `mcp__filesystem__read_file`
- [ ] **Step 4.2**：MCP 工具动态注册到 `globalToolRegistry`
  - verify: 重启后工具仍可用；MCP server 断开后工具自动移除
- [ ] **Step 4.3**：MCP 工具走与内置工具相同的 security/permission 校验
  - verify: MCP 提供的 `bash` 工具同样被白名单拦截

---

## 阶段五：Workflow Engine 简化（不投入）

> **当前决策**：不开发 Workflow Engine，改为 "预设 system prompt 模板"

- [ ] **Step 5.1**：把 `packages/workflow/builtin/*.js` 改为纯 system prompt 文件（删除 engine.ts 沙箱）
  - verify: `coding.js` 退化为 `export const systemPrompt = "..."`；`research.js`/`review.js` 同理
- [ ] **Step 5.2**：在 Core Loop 增加 `presetPrompts: Record<string, string>`，加载时按需注入
  - verify: 通过 `/workflow coding` 切换 system prompt；LLM 行为相应变化（如 coding 模式更注重代码风格）

**为什么不投入 Engine**：
- 真实 Agent 系统（Claude Code、Cursor、Devin）都没有"流程引擎"
- LLM 自己会判断阶段，硬编码 phase 是反模式
- 沙箱机制增加复杂度，但当前没有"自定义 workflow"需求
- 删除 engine.ts 后代码量 -300 行，维护成本显著降低

---

## 阶段六：测试与文档同步

- [ ] **Step 6.1**：每个 P0/P1 步骤必须有对应单元测试（vitest）
  - verify: `bun run test` 全过；覆盖率 >60%（聚焦 core/tools/security）
- [ ] **Step 6.2**：更新 `README.md` — Features 列表补全、版本号 0.1.0 → 0.2.0
  - verify: README 包含新功能描述；版本号一致
- [ ] **Step 6.3**：把 `docs/plans/roadmap.md` 中已完成的 P0/P1 移到"已完成"区
  - verify: roadmap.md 中"半成品"区只有真正未做的项
- [ ] **Step 6.4**：新增 `CHANGELOG.md` 记录每版本变更
  - verify: v0.2.0 条目涵盖 security、todo、diff 预览、MCP

---

## 不做什么（明确排除）

| 项 | 原因 |
|---|---|
| 重新加回七阶段 | 已被证伪，硬编码 phase 反人类 |
| 开发完整 Workflow Engine | 见阶段五说明 |
| 多模态深度优化（截图、OCR） | P3 远期，超出当前范围 |
| 语义搜索（向量嵌入） | FTS5 够用，向量化收益不明确 |
| HTTP API（`packages/server`） | 无客户端需求 |
| Obsidian/Database 集成 | 无使用场景 |
| IDE 插件（VS Code/JetBrains） | TUI 已能覆盖个人使用 |

---

## 执行模式

| 阶段 | 模式 | 备注 |
|---|---|---|
| 阶段零 | 手动 | 仅 3 个 commit，串行 |
| 阶段一 | 串行 subagent | P0 缺陷有依赖（security → tools），每步小 |
| 阶段二 | 可并行 | diff 预览和截断独立 |
| 阶段三 | 可并行 | CLAUDE.md 和窗口预警独立 |
| 阶段四 | 串行 | MCP 接入有 3 步依赖 |
| 阶段五 | 手动 | 简化是删除代码，不是开发 |
| 阶段六 | 手动 | 文档同步 |

**预计总投入**：
- 阶段零：30 分钟
- 阶段一：1.5 天（核心）
- 阶段二：1 天
- 阶段三：0.5 天
- 阶段四：1 天
- 阶段五：0.5 天
- 阶段六：0.5 天
- **合计约 5 天集中开发**

---

## 验收标准（最终）

1. ✅ 安全层默认开启，启动 TUI 后 LLM 无法 `rm -rf /` / 写 `.ssh/` / 跑未授权命令
2. ✅ 复杂任务（>3 步）LLM 主动写 todo，侧栏实时显示
3. ✅ 改文件前用户看到 diff，确认后才应用
4. ✅ 项目根有 `.licode.md`，LLM 自动读取并遵循
5. ✅ 长对话触发压缩前侧栏变黄预警
6. ✅ 配置 MCP server 后工具自动出现并走安全校验
7. ✅ Workflow Engine 删除，代码量减少 ~300 行
8. ✅ README + CHANGELOG + roadmap.md 同步更新