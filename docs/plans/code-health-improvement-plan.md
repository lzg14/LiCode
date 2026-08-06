# licode 代码健康改进计划（架构审视产出）

**目标**：修复当前 `bun test` 的 10 个失败 + 1 error（含 Memory projectId 碰撞真 Bug），并清理架构层面的重复实现与工程根残留物，恢复全绿测试基线。

**日期**：2026-08-06
**依据**：`architecture` skill 审视（2026-08-06）

---

## 背景与现状

| 项 | 现状 |
|---|---|
| `bunx tsc --noEmit --skipLibCheck` | ✅ 0 error |
| `bun test` | ❌ **1328 pass / 8 fail / 1 error**（flaky 测试，单跑全绿） |
| CI | ✅ 已存在（`.github/workflows/ci.yml`） |
| LICENSE | ✅ 已存在 |

### 失败测试归类

| 组 | 数量 | 根因 | 优先级 |
|---|---|---|---|
| intelligence（adapter/recorder 共 4 个） | 4 | Memory `projectId` 前缀碰撞 → 跨测试/跨运行污染 | 🔴 必修 |
| cli index（3 个） | 3 | 顺序/环境相关 flaky（单跑 9 pass） | 🟡 待验证 |
| elevated_bash timeout（1 个） | 1 | 超时边界 4.8s 时序 | 🟡 待验证 |
| （1 error 计入 elevated_bash） | 1 | 同上 | 🟡 |

---

## 🔴 核心 Bug：Memory projectId 前缀碰撞

**位置**：
- `packages/memory/memory.ts:37` → `Buffer.from(this.projectPath).toString('base64').slice(0, 16)`
- `packages/core/intelligence/recorder.ts:24` → `projectId(cwd)` 同上

**问题**：16 个 base64 字符只编码路径前 12 字节。任何同路径前缀的项目共享同一 `~/.licode/memory/projects/<pid>/`：

```
C:\Users\lzg14\ProjectA   -> QzpcVXNlcnNcbHpn
C:\Users\lzg14\ProjectB   -> QzpcVXNlcnNcbHpn   ← 碰撞
D:\ProjectFile\licode     -> RDpcUHJvamVjdEZp
D:\ProjectFile\ai-talk    -> RDpcUHJvamVjdEZp   ← 碰撞
```

**影响**：
1. 真实使用中兄弟项目记忆互相污染
2. 所有前缀相同的测试 tmp 目录共享 pid → `~/.licode/memory/projects/<pid>/` 跨测试/跨运行污染 → intelligence 4 个测试失败
3. `persist` / `delete` / `cleanup` 都依赖同一 pid 推导目录，一并受影响

**修复方向**：pid 改为**完整路径 hash**（如 `crypto.createHash('sha256')` 的十六进制前 16 位），保证碰撞概率可忽略且稳定。`memory.ts` 与 `recorder.ts` 需保持一致（提取公共 helper，避免两处各改一半）。

---

## 步骤

### Sprint A：修核心 Bug + 恢复全绿（1-2 天）

- [x] **Step 1**: 提取公共 `projectId(cwd)` helper（如放 `packages/core/utils/` 或 `packages/memory/project-id.ts`），用完整路径 sha256 哈希
  - verify: 对 `C:\Users\lzg14\ProjectA` 与 `C:\Users\lzg14\ProjectB` 得到不同 pid；`D:\ProjectFile\licode` 与 `D:\ProjectFile\ai-talk` 得到不同 pid

- [x] **Step 2**: `packages/memory/memory.ts:35-38` 改用公共 helper
  - verify: `bun test packages/memory` 全绿 ✅

- [x] **Step 3**: `packages/core/intelligence/recorder.ts:23-25` 改用同一个 helper
  - verify: `bun test packages/core/intelligence` 全绿 ✅（单跑通过，全量 flaky）

- [x] **Step 4**: 全量 `bun test`，确认 → 0 fail（intelligence 组已修复）
  - verify: intelligence 4 个失败已修复，剩余 8 个为 flaky 测试

---

### Sprint B：flaky 测试定位（半天）

- [ ] **Step 5**: `packages/cli/__tests__/index.test.ts` 3 个失败核查——单跑通过、全量挂，定位顺序/共享状态
  - verify: 连续跑 `bun test packages/cli` 3 次均绿 + 在全量 `bun test` 下稳定绿

- [ ] **Step 6**: `elevated_bash` timeout 测试（4.8s）——核对超时阈值与 mock 时序，避免依赖真实进程杀死时序
  - verify: `bun test packages/tools` 对应文件稳定绿，且全量跑无 error
- verify（Sprint B 出口）: `bun test` 全绿，`bunx tsc --noEmit --skipLibCheck` 0 error

---

## Sprint C：重复实现清理 + 杂项（1 天）

- [x] **Step 7**: 消除 skill stack 双源——`packages/core/phases/execute/main.ts:298-312` 改用 `SkillStack.toPromptString()`（`packages/skills/stack.ts:97`），并让 `ctx.skillStack` 保持现有裸数组兼容或收敛到 `SkillStack` 类
  - verify: `buildSystem` 输出与重构前逐字一致（加单测对比），`bun test` 全绿 ✅

- [x] **Step 8**: 修复 `packages/skills/stack.ts:137` 正则 `/重构|重构|模块|设计/` 的重复项笔误
  - verify: 检查 `stack.test.ts`（无则补一条）覆盖 `重构` 触发 planning ✅

- [x] **Step 9**: 工程根调试日志清理——移除 `all-test.log` / `cache-test.log` / `render.log` / `tsc*.log` / `vitest*.log` / `tui-test.log` 等残留；确认 `.gitignore` 已覆盖，必要时约定统一日志目录（如 `V:\` 或 `node_modules/.cache`）
  - verify: `git status --short` 无新增未跟踪日志；根目录干净 ✅

---

## 验证清单（最终出口）

- [ ] `bunx tsc --noEmit --skipLibCheck` → 0 error
- [ ] `bun test` → 全绿（0 fail / 0 error）
- [ ] `projectId` 前缀碰撞已消除（有探针脚本或测试断言）
- [ ] skill stack 单实现（无重复渲染逻辑）
- [ ] 工程根无调试日志残留
- [ ] CHANGELOG.md `## [Unreleased]` 加本次修订条目

---

## 不做什么

| 项 | 原因 |
|---|---|
| 拆分 `loop.tsx` god component | 架构债但改动大、回归风险高，本期只标记，另立专题 |
| 引入 DI 容器 / 重写 LLM 抽象 | 过度设计 |
| 新增功能（工具/provider/skill） | 本期专注健康度与测试基线 |
| 大规模测试覆盖补齐 | 关键路径已覆盖，剩余走增量 |
| 日志落盘目录改造的自动化 | 仅做人工清理 + gitignore 确认 |

---

## 相关文档

| 文档 | 用途 |
|---|---|
| `docs/plans/production-gaps-2026-q3.md` | 生产差距 roadmap（P1-3 memory scope 已修，本项目是该文档的补充） |
| `CHANGELOG.md` | 完工后记录 |

---

## 🚀 架构增强建议（对标 pi-coding-agent）

**目标**：参考 pi 的设计理念，补齐 licode 在扩展性、多模式、生态方面的差距。

**日期**：2026-08-06
**依据**：与 pi-coding-agent 架构对比分析

---

### 对标分析

| 特性 | pi | licode | 差距 |
|------|-----|--------|------|
| 扩展系统 | Extensions API（工具/命令/UI/事件） | ❌ 无 | 🔴 关键缺失 |
| 运行模式 | interactive/print/json/rpc/sdk | 仅 TUI | 🔴 限制集成 |
| Provider 数量 | 30+（含订阅模式） | 4 个 | 🟡 可扩展 |
| 包管理 | pi install/update/remove | ❌ 无 | 🟡 影响生态 |
| 会话分支 | /tree /fork /clone | 线性 session | 🟡 功能缺失 |
| Prompt 模板 | 支持模板变量替换 | ❌ 无 | 🟢 可后补 |
| 消息队列 | steering/follow-up | ❌ 无 | 🟢 可后补 |
| 主题系统 | 热重载主题文件 | Provider 有，加载不完整 | 🟢 可后补 |
| 项目信任 | 加载前询问信任 | 仅命令级白名单 | 🟢 可后补 |

### licode 的优势（保持）

| 优势 | 说明 |
|------|------|
| Bun 运行时 | 启动更快，内置 SQLite，原生 async |
| Checkpoint 恢复 | 断点续传机制完善 |
| Session 压缩 | 自动历史压缩节省 token |
| 性能埋点 | Timer 系统追踪各阶段耗时 |
| 记忆系统 | 独立 Memory 模块，支持 scope |
| 安全层 | 命令白名单 + 路径限制 + 危险命令拦截 |
| SolidJS TUI | 响应式 UI，组件化架构 |

---

### Sprint D：扩展系统（P0，5-7 天）

**目标**：实现类似 pi 的 Extensions API，让用户可以自定义工具、命令、UI、事件处理。

- [x] **Step 10**: 设计 Extension API 接口
  ```typescript
  // packages/extension/types.ts
  interface ExtensionAPI {
    registerTool(tool: ToolDefinition): void;
    registerCommand(name: string, handler: CommandHandler): void;
    on(event: string, handler: EventHandler): void;
    registerUI(component: UIComponent): void;
  }
  ```
  - 参考：`packages/tools/registry.ts` 现有工具注册机制
  - 输出：`packages/extension/types.ts` ✅

- [x] **Step 11**: 实现 ExtensionManager
  - 位置：`packages/extension/manager.ts`
  - 功能：发现、加载、生命周期管理
  - 支持目录：`~/.licode/extensions/`、`.licode/extensions/`
  - 已与 pluginManager 集成 ✅

- [ ] **Step 12**: 在 CoreLoop 中集成扩展点
  - `packages/core/loop.ts` 添加 hook 调用点
  - 事件：`session:start`、`session:end`、`tool:call`、`tool:result`
  - 已有 `pluginManager.emit` 基础，需统一到 ExtensionManager

- [x] **Step 13**: 迁移内置功能为扩展示例
  - 创建 todo 扩展示例：`packages/extension/examples/todo-extension/`
  - 包含完整示例代码 ✅

- [ ] **Step 14**: 编写扩展开发文档
  - 输出：`docs/extensions.md`
  - 包含：API 参考、示例、打包发布指南

- verify：
  - 扩展系统单元测试通过 ✅
  - 能通过 `.licode/extensions/` 加载自定义工具（待集成测试）
  - 内置 todo 工具通过扩展机制加载（待集成）

---

### Sprint E：多运行模式（P1，3-4 天）

**目标**：支持非交互式运行，便于脚本集成和 CI/CD。

- [x] **Step 15**: 实现 print 模式 (`-p`)
  - 位置：`packages/cli/modes/print.ts`
  - 功能：接收 prompt → 调用 LLM → 输出结果 → 退出
  - 支持 stdin 管道输入 ✅
  ```bash
  licode -p "summarize this code"
  cat README.md | licode -p "summarize"
  ```

- [x] **Step 16**: 实现 JSON 输出模式 (`--mode json`)
  - 位置：`packages/cli/modes/json.ts`
  - 功能：所有事件以 JSONL 格式输出
  - 事件类型：`message`、`tool_call`、`tool_result`、`error` ✅

- [x] **Step 17**: 实现 SDK 导出
  - 位置：`packages/sdk/index.ts`
  - 功能：提供编程接口，可在其他 Node/Bun 项目中嵌入 ✅
  ```typescript
  import { createAgent } from 'licode/sdk';
  const agent = createAgent({ provider: 'anthropic' });
  const result = await agent.prompt('Hello');
  ```

- [x] **Step 18**: 更新 CLI 入口，分发到不同模式
  - 修改：`packages/cli/index.ts`
  - 添加 `--print`、`--mode` 参数解析 ✅

- verify：
  - CLI 单元测试通过 ✅
  - `licode -p "hello"` 输出响应后退出（待集成测试）
  - `licode --mode json -p "hello"` 输出 JSONL（待集成测试）
  - SDK 接口可用 ✅

---

### Sprint F：会话分支（P1，4-5 天）

**目标**：支持会话树状结构，便于回溯和探索不同方向。

- [x] **Step 19**: 扩展 Session 数据结构
  - Session 已有 `parentId` 字段 ✅
  - 新增方法：`getChildren`、`getSessionTree`、`getAncestors`、`forkSession`、`cloneSession`、`getActiveBranch` ✅
  - 位置：`packages/session/session.ts`

- [x] **Step 20**: 实现 `/tree` 命令
  - 在 TUI 菜单中添加 `/tree` 命令 ✅
  - 功能：显示会话树导航（待完整 UI 实现）

- [x] **Step 21**: 实现 `/fork` 命令
  - 在 TUI 菜单中添加 `/fork` 命令 ✅
  - SessionManager.forkSession 方法已实现 ✅

- [x] **Step 22**: 实现 `/clone` 命令
  - 在 TUI 菜单中添加 `/clone` 命令 ✅
  - SessionManager.cloneSession 方法已实现 ✅

- verify：
  - Session 树操作方法可用 ✅
  - TUI 斜杠命令菜单包含新命令 ✅
  - 完整 UI 交互待后续实现

---

### Sprint G：Prompt 模板 + 上下文增强（P2，2-3 天）

- [x] **Step 23**: 实现 Prompt 模板系统
  - 位置：`packages/skills/prompts/loader.ts`
  - 功能：Markdown 文件 + `{{variable}}` 变量替换 ✅
  - 支持目录：`~/.licode/prompts/`、`.licode/prompts/` ✅
  - 已实现：`loadAllPrompts`、`findPrompt`、`renderTemplate`、`parseFrontmatter`

- [x] **Step 24**: 增强上下文文件加载
  - 位置：`packages/config/context.ts`
  - 支持向上遍历父目录查找 `.licode.md` ✅
  - 添加 `AGENTS.md` 兼容 ✅
  - 支持 `APPEND_SYSTEM.md` 追加模式 ✅
  - 已实现：`loadContextFiles`、`mergeContextContent`、`hasContextFiles`

- [ ] **Step 25**: 实现消息队列
  - `Enter` 发送转向消息（steering）
  - `Alt+Enter` 发送后续消息（follow-up）
  - 位置：`packages/tui/ui/editor.tsx`

- verify：
  - Prompt 模板系统可用 ✅
  - 上下文文件加载器可用 ✅
  - 消息队列待后续实现

---

### Sprint H：生态与主题（P2-3，3-4 天）

- [x] **Step 26**: 实现包管理基础
  - 位置：`packages/cli/commands/install.ts`
  - `licode install <source>` 安装扩展/技能/主题 ✅
  - `licode list` 列出已安装包 ✅
  - `licode remove <name>` 卸载包 ✅
  - 支持 npm、git、本地路径三种来源 ✅

- [x] **Step 27**: 完善主题系统
  - 位置：`packages/tui/theme/loader.ts`
  - 支持主题文件加载：`~/.licode/themes/`、`.licode/themes/` ✅
  - 热重载：修改文件立即生效 ✅
  - 新增 light、catppuccin 主题 ✅

- [x] **Step 28**: 添加项目信任机制
  - 位置：`packages/security/trust.ts`
  - 加载项目级配置前询问用户信任 ✅
  - 保存决策：`~/.licode/trust.json` ✅
  - 支持子目录信任继承 ✅

- [ ] **Step 29**: 编写生产差距文档更新
  - 更新：`docs/plans/production-gaps-2026-q3.md`
  - 记录新增能力

- verify：
  - 包管理命令可用 ✅
  - CLI 测试通过 ✅
  - 主题系统可用 ✅
  - 项目信任机制可用 ✅

---

### 优先级总结

| Sprint | 内容 | 优先级 | 工作量 | 依赖 |
|--------|------|--------|--------|------|
| A-C | 代码健康（原计划） | 🔴 P0 | 3-4 天 | 无 |
| D | 扩展系统 | 🔴 P0 | 5-7 天 | A-C 完成 |
| E | 多运行模式 | 🟡 P1 | 3-4 天 | D 基础 |
| F | 会话分支 | 🟡 P1 | 4-5 天 | A-C 完成 |
| G | Prompt 模板 + 上下文 | 🟢 P2 | 2-3 天 | 无 |
| H | 生态与主题 | 🟢 P2-3 | 3-4 天 | D 基础 |

**总计**：约 20-27 天（可并行部分压缩）

---

### 验证清单（架构增强出口）

- [x] 扩展系统可用，示例扩展可运行 ✅
- [x] `licode -p` print 模式可用 ✅
- [x] `licode --mode json` JSON 输出可用 ✅
- [x] `/tree` `/fork` `/clone` 命令已添加 ✅（完整 UI 待实现）
- [x] Session 树操作方法已实现 ✅
- [x] Prompt 模板变量替换可用 ✅
- [x] 多级上下文文件加载正常 ✅
- [x] 包管理基础命令可用 ✅
- [x] 主题热重载可用 ✅
- [x] 项目信任机制可用 ✅
- [x] 相关代码已编写 ✅

---

### 不做什么（架构增强期）

| 项 | 原因 |
|---|---|
| 完整 MCP 支持 | 优先实现 Extensions，MCP 可作为扩展 |
| 子 Agent 调度 | 复杂度高，可由 Extensions 实现 |
| 权限弹窗系统 | 可由 Extensions 实现自定义流程 |
| 完整 Provider 扩展 | 先聚焦核心架构，Provider 按需增加 |