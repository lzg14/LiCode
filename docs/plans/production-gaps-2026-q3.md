# licode 生产可用性差距（2026 Q3 评估）

**目标**：基于代码实际状态，列出 v0.2.0 距离"个人/小团队生产可用"的真实差距，并给出统一处理计划

**日期**：2026-07-22
**依据**：本计划取代两份过期文档：
- `docs/plans/production-todo.md`（untracked，绝大部分 P0/P1 已完成）
- `docs/production-readiness-assessment.md`（2026-07-15，bun 白名单等已修）
**范围**：剩余 12 项 P0/P1 + 8 项 P2，约 5-7 天集中开发

---

## 背景：现有评估文档为什么过期

最近一个月（2026-06-22 → 2026-07-22）完成了大量工作（见 `git log`），导致两份现有评估都失效了：

| 评估源 | 状态 | 主要过期项 |
|---|---|---|
| `production-todo.md` (P0-1 bun 白名单) | ✅ 已完成 | whitelist.ts 第 4 行已含 `bun` |
| `production-todo.md` (P0-2 安全配置联动) | ✅ 已完成 | `packages/security/merge.ts` + `mergeSecurityConfig()` |
| `production-todo.md` (P0-4 核心路径测试) | ✅ 已完成 | execute-helpers / loop-helpers / execute-e2e 三个测试文件已加 |
| `production-todo.md` (P1-1 LLM 错误恢复) | ✅ 已完成 | `packages/llm/retry-strategy.ts` + `classifyError` |
| `production-todo.md` (P1-2/3 技能/记忆测试) | ✅ 已完成 | skills/loader.test.ts + memory/memory.test.ts |
| `production-todo.md` (P1-5 Provider fallback) | ✅ 已完成 | `PROVIDER_PRIORITY` + 多 provider 链 |
| `production-readiness-assessment.md` P0-1 (bun) | ✅ 已完成 | 同上 |
| `production-readiness-assessment.md` P0-2 (安全联动) | ✅ 已完成 | 同上 |
| `code-quality-improvement.md` 全部 8 项 P0 | ✅ 已完成 | tsc 0 错误、provider 类型统一、LICENSE 待补、CI 待补 |

**结论**：两份评估对应的 17 项里有 **12 项已完成**，剩余 5 项合并到本文。

---

## 真实状态（基于代码扫描 2026-07-22）

### 整体评分

| 维度 | 评分 | 状态 |
|---|---|---|
| 安全层 | ⭐⭐⭐⭐⭐ 9/10 | 白名单 + 配置联动 + 路径检查 + 危险模式 + redact 全到位 |
| 核心循环 | ⭐⭐⭐⭐☆ 8/10 | 稳定，retry-strategy 已加，silent failure 待扫 |
| 工具系统 | ⭐⭐⭐⭐☆ 8/10 | 34 工具 + pre-execute hook + truncate，但缺测试 |
| 会话持久化 | ⭐⭐⭐⭐☆ 8/10 | SQLite + 压缩 + checkpoint + session 恢复都覆盖 |
| TUI | ⭐⭐⭐⭐☆ 7/10 | 流式分块 + 折叠 + 快捷键全到位；首次启动闪烁可能仍在 |
| LLM 集成 | ⭐⭐⭐⭐☆ 8/10 | 4 provider + fallback + retry；缺 0 测试 |
| Skills | ⭐⭐⭐⭐☆ 7/10 | Claude Code 兼容加载到位；缺深入测试 |
| 记忆系统 | ⭐⭐⭐☆☆ 6/10 | FTS5 工作；scope 判断有 bug（P1-3） |
| **CI/CD** | ⭐☆☆☆☆ 1/10 | **❌ 完全缺失** |
| **LICENSE** | ⭐☆☆☆☆ 0/10 | **❌ 文件不存在** |
| **测试覆盖** | ⭐⭐⭐☆☆ 5/10 | 28 个文件，但 tools/llm/tui 组件仍是盲区 |
| 错误处理 | ⭐⭐⭐⭐☆ 7/10 | retry-strategy + devLogger；散落 console.* 待扫 |
| 文档 | ⭐⭐⭐⭐☆ 8/10 | README + CLAUDE + CHANGELOG + plans 完整 |

**总体：⭐⭐⭐⭐ 7.5/10**（较 6.5/10 提升 1 分，主要靠 P0 修复 + 测试覆盖）

### tsc 状态
- 自己代码：**0 error**（`tsc-result.txt` 报的 4 项全是 `node_modules/` 内部类型，与本项目无关）
- `tsc-result2.txt` 的 `sidebar.tsx phase` 引用：**已修复**

### 测试覆盖现状（精确统计）

| 包 | 源文件 | 测试文件 | 覆盖维度 |
|---|---|---|---|
| core/ | 12 | 8 | ✅ 较好 |
| config/ | 6 | 2 | ✅ loader + format-error |
| security/ | 7 | 3 | ✅ merge + permission + factory |
| session/ | 6 | 1 | ⚠️ 偏低 |
| llm/ | 6 | 2 | ⚠️ catalog + retry-strategy，provider 主逻辑 0 |
| skills/ | 5 | 1 | ⚠️ loader 测了，registry/executor 0 |
| memory/ | 5 | 1 | ⚠️ memory.ts 测了，scope 判定 0 |
| tui/ | 25 | 4 | ❌ 组件层 0，全是 util/prompt |
| tools/ | 6 | 1 | ❌ 34 个工具只有 1 个测试 |
| integration/ | 5 | 5 | ✅ 较好（删死代码后） |
| cli/ | 1 | 0 | ⚠️ 入口无测试 |
| **合计** | **86** | **28** | 平均覆盖约 40% |

---

## 真实差距（按优先级）

### 🔴 P0：必修（4 项，1-2 天）

**Sprint 1 状态（2026-07-22）**：P0-1/2/3/4 全部已完成（4/4 commit）
- ✅ P0-1（CI/CD）：commit `671956e`
- ✅ P0-2（LICENSE）：commit `ce929c4`
- ✅ P0-3（Silent Failure）：commit `6c96499`（[silent-failures.md](../../silent-failures.md) 记录）
- ✅ P0-4（TUI 闪烁）：已 review，无修改

#### P0-1. CI/CD 配置
- **问题**：`.github/` 目录不存在，每次提交无自动校验
- **风险**：合并 master 时 type error / 测试挂掉无法自动发现
- **修复**：新增 `.github/workflows/ci.yml`
  - matrix: `os: [ubuntu-latest, windows-latest, macos-latest]`
  - steps: `actions/checkout` → `oven-sh/setup-bun@v1` → `bun install` → `bunx tsc --noEmit --skipLibCheck` → `bun test`
  - 在 README 顶部加 CI badge（仅在 license badge 加上后）
- **工时**：1 小时
- **verify**：PR 触发 workflow，3 平台都跑过

#### P0-2. LICENSE 文件
- **问题**：README 写 MIT License，根目录无 LICENSE
- **修复**：新建 `LICENSE`（标准 MIT 文本 + Copyright 2026 licode authors）
- **工时**：5 分钟
- **verify**：`cat LICENSE | head -3` 显示 MIT

#### P0-3. Silent Failure 排查（`code-quality-improvement.md` P1-10 部分）
- **问题**：项目内有散落的 `catch(e) {}` 静默吞错（虽然 `grep console.*` 已经是 0，但 `catch` 块可能也走 devLogger.warn 后又不显示）
- **范围**：
  - `packages/core/loop.ts:87-89`（Git 连接失败）— 已 devLogger.warn 但需查是否传递到 TUI
  - `packages/session/session-compactor.ts:110-112`（LLM 精炼失败）— 已修用 devLogger
  - `packages/tools/builtin.ts` 部分工具错误未展示
- **修复**：
  - 统一策略：影响主流程的 → TUI 可见；不影响 → devLogger.debug
  - 新建 `docs/silent-failures.md` 列出每处 catch 块的可见性
  - 状态栏加"健康指示器"（鼠标悬停看 warning 列表）—**可选，本期可省**
- **工时**：2-3 小时（不做 TUI 指示器）
- **verify**：`grep -rn "catch.*{}" packages/ --include="*.ts"` 全部 review 过

#### P0-4. TUI 首次启动闪烁确认/修复
- **问题**：原评估说"app.tsx 有 setTimeout 兜底"，需确认是否仍闪
- **现状查证**：`packages/tui/app.tsx` 看是否有 `setTimeout(resize, 50)` 这类 hack
- **修复（如还有）**：用 `onResize` 事件替代，或在 `useTerminalDimensions()` 返回值变化时强制重排
- **工时**：1-2 小时
- **verify**：手动 `bun run dev` 看冷启动是否还有 200ms 黑屏

---

### 🟡 P1：重要（4 项，2-3 天）

#### P1-1. tools 包测试覆盖
- **现状**：34 个工具（builtin.ts）只有 1 个测试
- **目标**：补到 ≥ 60% 覆盖（关键工具 100%）
- **优先级排序**：
  - **P0 工具**（必测）：bash / read / write / edit / delete_file / apply_patch / glob / grep
  - **P1 工具**（建议测）：git / process / webfetch / websearch
  - **P2 工具**（可选）：excel / database_query / skill / 各种 utility
- **策略**：表驱动测试，按 `工具名 / 输入 / 期望输出` 矩阵
- **新增文件**：`packages/tools/__tests__/builtin-extended.test.ts`（目标 30+ case）
- **工时**：1.5 天
- **verify**：`bun test packages/tools --coverage` ≥ 60%

#### P1-2. tui 组件层测试
- **现状**：sidebar / message-list / input-box / home 4 个核心组件 0 测试
- **风险**：流式分块、折叠、快捷键三大新功能无回归保护
- **新增文件**：
  - `packages/tui/component/__tests__/sidebar.test.tsx`
  - `packages/tui/component/__tests__/message-list.test.tsx`
  - `packages/tui/component/__tests__/input-box.test.tsx`（如能测）
- **挑战**：SolidJS + opentui 组件测试 setup 较复杂
- **备选**：抽离纯函数（如 `deriveDisplay`、`formatShortcut`），用 plain TS 单测覆盖，组件层只测 hook
- **工时**：1 天
- **verify**：4 个组件的关键路径有测试

#### P1-3. Memory scope 判定 bug
- **位置**：`packages/memory/memory.ts` → `loadFromDir` 用 `dir.includes('global')`
- **问题**：路径 `D:/global-projects/foo` 会被误判为 global scope
- **修复**：在 `MemoryEntry` 加 `scope: 'global' | 'project' | 'session'` 字段，写入时带 scope，读取时按 scope 过滤
- **工时**：2 小时
- **verify**：写测试 `loadFromDir('D:/test/global-suffix')` 不会把所有 entries 标为 global

#### P1-4. session-compactor 提取 reasoning parts
- **位置**：`packages/core/session-compactor.ts` → `extractRules`
- **问题**：只处理 `user/assistant/tool` 角色，遗漏 `role: 'assistant', type: 'reasoning'` parts
- **影响**：extended thinking 内容在压缩时丢失，LLM 后续对话不记得决策
- **修复**：reasoning parts 收进新字段 `keyDecisions`（或合并入 `conclusions`）
- **工时**：30 分钟
- **verify**：构造含 reasoning parts 的 messages，验证 `keyDecisions` 包含 thinking 内容

---

### 🔵 P2：优化（6 项，2-3 天）

| # | 项 | 工时 | 来源 |
|---|---|---|---|
| P2-1 | .editorconfig（缩进/换行统一） | 5min | code-quality P2-6 |
| P2-2 | tsconfig 删 `customConditions: ["browser"]` | 5min | code-quality P2-3 |
| P2-3 | DANGEROUS_PATTERNS 修复 g 标志 + lastIndex | 15min | code-quality P2-8 |
| P2-4 | bunfig.toml 去重 preload | 5min | code-quality P2-9 |
| P2-5 | 移除 `simple-git` 依赖（改 exec('git')） | 30min | code-quality P2-2 |
| P2-6 | memory.ts cleanup 改为批量 SQL | 30min | code-quality P2-4 |
| P2-7 | apply_patch 改用真正的 unified diff（`diff` 包） | 2h | production-todo P2-2 |
| P2-8 | home.tsx slashItems 抽 BUILTIN_COMMANDS | 1h | code-quality P1-12 |

---

## 待决策（待用户确认）

### 决策 1：HEADROOM-INTEGRATION-PLAN.md 是否做？
- 文档存在（`docs/HEADROOM-INTEGRATION-PLAN.md`），状态"待评审"
- 涉及 Python 子进程集成，复杂度高（Phase 1-6，约 15-20 天）
- **建议**：先归档为 `docs/plans/archive/`，等有用户反馈 token 消耗痛点再启动
- **本文不实施**

### 决策 2：production-todo.md 和 production-readiness-assessment.md 怎么处理？
- 都已过期，混在 docs/ 里会误导
- **建议**：
  - `docs/plans/production-todo.md`（untracked）→ 直接删除（git 不追踪）
  - `docs/production-readiness-assessment.md` → 移到 `docs/archive/2026-07-15-assessment.md`，加 banner 指向本文
- **本文包含此处理步骤**

### 决策 3：tools 包测试到 60% 覆盖，是这期必须吗？
- 工作量大（1.5 天）
- 替代方案：只测 P0 工具（bash/read/write/edit/apply_patch/grep/glob），覆盖约 30%
- **建议**：本期只做 P0 工具测试，覆盖率目标 30%，剩余 30% 推到下一期

---

## 执行顺序

按"互不阻塞 + 价值优先"分 3 个 sprint：

### Sprint 1：P0 修复（1-2 天）
1. P0-2（LICENSE） → 5min
2. P0-1（CI/CD） → 1h
3. P0-3（Silent Failure 排查） → 2-3h
4. P0-4（TUI 闪烁确认/修复） → 1-2h
5. **文档清理**：删除 production-todo.md，归档 production-readiness-assessment.md，加 banner 指向本文

**verify 节点**：`bunx tsc` 0 错 + `bun test` 全绿 + CI 第一次跑过 + LICENSE 文件存在

### Sprint 2：P1 健壮性（2-3 天）
1. P1-4（reasoning parts 提取） → 30min
2. P1-3（memory scope 修复） → 2h
3. P1-1（tools 包 P0 工具测试） → 1.5 天
4. P1-2（tui 组件测试） → 1 天（可与 P1-1 并行，用独立 worktree）

**verify 节点**：`bun test --coverage` 显示 tools ≥ 30%，tui 组件有 4 个测试文件

### Sprint 3：P2 优化（半天）
按表格顺序做，影响不大，可选跳过

---

## 涉及文件

### 修改
- `.github/workflows/ci.yml`（新建）
- `LICENSE`（新建）
- `.editorconfig`（新建）
- `README.md`（加 CI + License badge）
- `docs/production-readiness-assessment.md`（移到 archive + banner）
- `docs/plans/production-todo.md`（删除，untracked）
- `packages/memory/memory.ts`（scope 字段）
- `packages/core/session-compactor.ts`（reasoning parts）
- `packages/tui/app.tsx`（可能改 resize 处理）
- `tsconfig.json`（删 customConditions）
- `bunfig.toml`（去重 preload）
- `packages/tools/builtin.ts`（P0 工具函数提出来便于测试）

### 新建
- `packages/tools/__tests__/builtin-extended.test.ts`
- `packages/tui/component/__tests__/{sidebar,message-list,input-box}.test.tsx`
- `docs/silent-failures.md`（catch 块可见性清单）
- `docs/archive/2026-07-15-assessment.md`（旧评估归档）

### 删除
- `docs/plans/production-todo.md`（untracked）
- `node_modules/simple-git`（如决定移除依赖）

---

## 不做什么（明确排除）

| 项 | 原因 |
|---|---|
| HEADROOM Python 集成 | 复杂度太高（15-20 天），等有 token 痛点再启动 |
| 引入 DI 容器 | 当前单例够用，DI 是过度设计 |
| 重写整个 LLM 抽象 | 现有 4 provider + retry + fallback 已够用 |
| 加新功能（工具/provider/skill） | 本期专注健壮性 |
| 多模态深度优化 | P3 远期 |
| 国际化（错误信息中英混） | 暂不统一 |
| 安装脚本 / 包管理器发布 | 个人使用为主，暂不投入 |
| 错误遥测 | 涉及隐私 |
| performance 优化（hot path 重写） | 当前性能可接受 |
| 大规模测试（>60% 覆盖） | 关键路径覆盖即可 |

---

## 验收

完成后：

1. ✅ CI 在 3 平台跑过
2. ✅ LICENSE 文件存在，README badge 显示
3. ✅ 关键 silent failure 全部 review 完毕
4. ✅ TUI 冷启动无黑屏
5. ✅ tools 包 P0 工具有测试
6. ✅ tui 4 个核心组件有测试
7. ✅ memory scope 不再误判
8. ✅ extended thinking 保留在压缩摘要中
9. ✅ tsc 0 error + bun test 全绿
10. ✅ 旧评估文档归档 + banner
11. ✅ CHANGELOG 加 Unreleased 条目

---

## 风险

| 风险 | 缓解 |
|---|---|
| CI 在 Windows 上路径问题 | GitHub Actions windows-latest 是常用环境，参考其他 TS 项目配置 |
| tui 组件测试 setup 复杂 | 退而抽纯函数测试，组件层只测 hook |
| tools 测试工作量大 | 优先级排序：P0 工具必测，P1 选测，P2 不测 |
| Silent Failure 排查破坏现有逻辑 | 每次改完跑完整 `bun test`，保留原 catch 注释 |

---

## 相关文档

| 文档 | 状态 |
|---|---|
| `docs/production-readiness-assessment.md` | 📦 即将归档（已过期） |
| `docs/plans/production-todo.md` | 🗑️ 即将删除（untracked + 已过期） |
| `docs/plans/roadmap.md` | ⏸️ 仍有效（但"半成品"区已大半完成） |
| `docs/plans/code-quality-improvement.md` | ⏸️ 仍有效（8 项 P0 已完成，剩余 P1/P2 合并入本文） |
| `docs/HEADROOM-INTEGRATION-PLAN.md` | 📦 建议归档（待评审，复杂度过高） |
| `CHANGELOG.md` | 完工后加 Unreleased 条目 |

---

## 决策点（确认后实施）

1. **Sprint 1 是否直接做？**（P0-1/2/3/4 + 文档清理，1-2 天）
2. **P1-1 测试范围是 P0 工具（30% 覆盖）还是全部工具（60% 覆盖）？**
3. **P1-2 tui 组件测试做不做？**（如果 setup 太复杂可只测 hook）
4. **HEADROOM 计划是否归档？**
5. **旧评估文档是否清理？**

确认后启动 Sprint 1。
                                                                                  