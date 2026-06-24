# licode 生产可用性审计（2026-06-24 补充版）

**目标**：在 `production-gaps-2026-q3.md`（2026-07-22，未来日期但内容已生效）基础上，做一次**代码-现状对照**，补出 q3 报告未覆盖或新出现的真实差距。

**日期**：2026-06-24
**依据**：基于 commit `7066004`（HEAD）的实际代码扫描 + git log 完整审计 + CLAUDE.md / README / CHANGELOG / package.json 元数据核对
**关系**：本文**不取代** `production-gaps-2026-q3.md`，而是它的**事实纠错 + 新增项**。两者结合即完整生产化路线。

---

## 总体评分：⭐⭐⭐⭐ 8.0/10（较 q3 评估 7.5 提升 0.5）

| 维度 | q3 评分 | 本次 | 变化 | 说明 |
|---|---|---|---|---|
| 安全层 | 9/10 | 9/10 | — | registry.ts + whitelist.ts + silent-failures.md 全到位 |
| 核心循环 | 8/10 | 9/10 | +1 | 7066004 把压缩阈值改为 context window 80%，自适应每模型 |
| 工具系统 | 8/10 | 8/10 | — | 39 工具 + 安全 hook，但覆盖率仍极低（见 P1-1） |
| 会话持久化 | 8/10 | 9/10 | +1 | SQLite + 压缩 + checkpoint + reasoning parts + 80% 阈值 |
| TUI | 7/10 | 7/10 | — | 流式分块 + thinking 折叠 + 快捷键全到位；tui-render-optimization.md 未实施 |
| LLM 集成 | 8/10 | 8/10 | — | 4 provider + fallback + retry；provider 主路径测试仍为 0 |
| Skills | 7/10 | 7/10 | — | 兼容加载到位；executor / hot-reload 未测 |
| 记忆系统 | 6/10 | 8/10 | +2 | scope 判定已改 `dir === globalDir` 严格相等（不是 `.includes`），bug 不复现 |
| **CI/CD** | 1/10 | 10/10 | **+9** | ✅ 671956e 已落地（3 OS 矩阵 + tsc + test + build smoke）|
| **LICENSE** | 0/10 | 10/10 | **+10** | ✅ ce929c4 已落地 MIT |
| **测试覆盖** | 5/10 | 5/10 | — | 28 测试文件 / 86 源文件 = 33%，核心模块有覆盖但工具有盲区 |
| 错误处理 | 7/10 | 8/10 | +1 | silent-failures.md 完整记录 8 处 catch 的可见性 |
| 文档 | 8/10 | 8/10 | — | README + CLAUDE + CHANGELOG + plans 完整 |
| **代码规范** | 0/10 | 0/10 | — | ❌ 无 ESLint / Prettier / biome（CLAUDE.md 已承认）|
| **发布/打包** | 0/10 | 1/10 | +1 | 仅 `bun run build` 烟雾测试，无 release workflow / package 发布 |

---

## 一、q3 报告已修但仍需关注

| q3 项 | 现状 | 残留风险 |
|---|---|---|
| P0-1 CI/CD | ✅ done（671956e） | CI 仍**无 coverage 上传 / 无 lint step / 无 artifact 上传** |
| P0-2 LICENSE | ✅ done（ce929c4） | **LICENSE 写"licode authors"模糊**，无个人/组织名 |
| P0-3 Silent Failure | ✅ done（6c96499） | 文档列 8 处 catch，**部分行号已过期**（memory.ts 行号 57/108/136 与代码不匹配）|
| P0-4 TUI 闪烁 | ✅ done（8038543） | 无 |
| P1-3 Memory scope bug | ✅ done（代码实际是 `dir === globalDir`，不再误判） | **silent-failures.md 第 1 项仍写"57/108/136"**，需同步更新 |
| P1-4 reasoning parts | ✅ done（6c96499 + 9a1635e） | 无 |

---

## 二、新发现的问题（本审计独有）

### 🔴 P0：必修（6 项，1 天）

#### P0-1. README CI badge 链接是占位符
- **位置**：`README.md:3`
- **现状**：`[![CI](https://github.com/your-username/licode/actions/workflows/ci.yml/badge.svg)](https://github.com/your-username/licode/actions/workflows/ci.yml)`
- **问题**：`your-username` 是字面占位符，badge 点击跳转 404。真实仓库是 `lzg14/licode`（origin remote 确认）
- **影响**：用户/外部协作者点 badge 直接 404，对项目形象损害
- **修复**：`your-username` → `lzg14`
- **工时**：2 分钟
- **verify**：`curl -I https://github.com/lzg14/licode/actions/workflows/ci.yml/badge.svg` 返回 200

#### P0-2. bunfig.toml preload 路径错误
- **位置**：`bunfig.toml:1, 4`
- **现状**：
  ```toml
  preload = ["./.preload"]

  [test]
  preload = ["./.preload"]
  ```
- **问题**：仓库里**实际只有 `.preload.js`**，没有 `.preload`（无扩展名）。`7af500d` commit message 说"创建本地 .preload.js 替代"，但 `bunfig.toml` **没同步改路径**
- **影响**：在 Windows 上 `bun test` 找不到 preload，SolidJS 转换插件未加载，相关测试可能失败
- **修复**：`.preload` → `.preload.js`（两处）
- **工时**：2 分钟
- **verify**：`bun test packages/core` 跑通；`bun run dev` 不报 preload 错误

#### P0-3. package.json 缺关键元数据
- **位置**：`package.json`
- **现状**：缺以下字段
  - `repository`（无 GitHub 链接）
  - `homepage`
  - `bugs`
  - `keywords`（数组，npm 搜索可见）
  - `author`（LICENSE 已说"licode authors"模糊）
  - `license: "MIT"`（虽有 LICENSE 文件，但 npm 元数据缺）
  - `description`（README 有但 package.json 没）
- **影响**：`npm publish` 会失败 / 信息残缺；GitHub 自动识别项目语言/标签失效
- **修复**：
  ```json
  {
    "description": "Terminal-native AI coding agent — SolidJS + @opentui + multi-provider + persistent sessions",
    "keywords": ["ai", "cli", "agent", "tui", "solidjs", "anthropic", "openai", "deepseek", "bun"],
    "license": "MIT",
    "repository": {
      "type": "git",
      "url": "git+https://github.com/lzg14/licode.git"
    },
    "homepage": "https://github.com/lzg14/licode#readme",
    "bugs": {
      "url": "https://github.com/lzg14/licode/issues"
    },
    "author": "lzg14 <lzg14@users.noreply.github.com>"
  }
  ```
- **工时**：5 分钟
- **verify**：`npm pack --dry-run` 能识别元数据

#### P0-4. LICENSE 作者名模糊
- **位置**：`LICENSE:2`
- **现状**：`Copyright (c) 2026 licode authors`
- **问题**：法律主体模糊，不利于版权追溯
- **修复**：与 P0-3 的 `author` 字段对齐 → `Copyright (c) 2026 lzg14`（或真实姓名）
- **工时**：1 分钟
- **决策点**：需用户确认 GitHub 用户名对应真实姓名（commit 作者邮箱是 `lizhgb@yonyou.com`）

#### P0-5. README/CLAUDE/CHANGELOG 工具数 + provider 名不一致
- **位置**：多处
- **现状**：
  | 文档 | 工具数 | provider 名 |
  |---|---|---|
  | CLAUDE.md:23 | "38 个内置工具" | "DeepSeek" |
  | CHANGELOG [0.3.0] | — | — |
  | README.md:7 | — | "DeepSeek / MiniMax" |
  | production-gaps-2026-q3.md | "34 工具"¹ | — |
  | **实际 builtin.ts** | **39 工具**（read, write, edit, list_directory, create_directory, delete_file, move_file, copy_file, glob, grep, codesearch, stat, bash, env_vars, datetime, system_info, process_list, kill_process, open_explorer, open_url, gh, git_status, git_diff, git_log, git_commit, webfetch, websearch, run_tests, install_deps, format, lint, skill, database_query, apply_patch, excel_read, excel_write, read_image, todo_write, todo_read）| **minimax**（小写 provider id）|

¹ CHANGELOG 自 0.1.0 起**从未列过工具数**（仅列变更项）；原"34 工具"为审计时的事实错误。production-gaps-2026-q3.md 的 34 工具是 2026-07-22 评估快照当时的事实，**按归档原则不动**。
- **影响**：用户/外部协作者困惑；README 与实际代码不一致
- **修复**：
  - CLAUDE.md 工具数 38 → 39
  - README "MiniMax" → "minimax"（或对齐 anthropic/openai 的 lowercase）
  - ~~CHANGELOG [0.3.0] 34 → 39~~（**已删除**：CHANGELOG 从未列过工具数，无修改目标）
  - production-gaps-2026-q3.md **不动**（历史快照归档）
- **工时**：10 分钟
- **verify**：`grep -rn "38 个\|34 工具\|34 个工具" docs/ README.md CLAUDE.md`（排除 `docs/archive/` 和 `docs/plans/archive/`）全部更新

#### P0-6. 缺 SECURITY.md 漏洞披露策略
- **位置**：仓库根
- **现状**：仓库根无 `SECURITY.md`，只有 `docs/modules/security.md`（设计文档，非漏洞政策）
- **影响**：
  - 用户/安全研究者发现漏洞后无报告渠道
  - GitHub Security Advisories 自动链接不到策略文档
- **修复**：新建 `SECURITY.md`（最少含 Supported Versions + Reporting 段落）
- **工时**：10 分钟
- **verify**：`https://github.com/lzg14/licode/security/policy` 能渲染

---

### 🟡 P1：重要（5 项，2-3 天）

#### P1-1. 工具包测试覆盖严重不足
- **现状**：39 个工具中只有 1 个测试文件（`packages/tools/__tests__/builtin.test.ts`）
- **风险**：
  - `bash` / `read` / `write` / `edit` / `delete_file` / `apply_patch` 等 P0 工具无回归保护
  - 后续优化（如 truncateOutput 阈值调整）无安全网
- **优先级**：
  - **P0 工具（必测）**：bash / read / write / edit / delete_file / apply_patch / glob / grep
  - **P1 工具（建议测）**：git_* / process_* / webfetch / websearch
  - **P2 工具（可选）**：excel_* / read_image / todo_* / database_query / lint / format / install_deps / run_tests / skill
- **策略**：表驱动，按"工具名 / 输入 / 期望输出"矩阵；优先测 happy path + 已知历史 bug 路径
- **新增**：`packages/tools/__tests__/builtin-extended.test.ts`（目标 30+ case）
- **工时**：1.5 天
- **verify**：`bun test packages/tools --coverage` 显示 ≥ 30% 行覆盖

#### P1-2. 缺 ESLint / Prettier / biome 之一
- **现状**：项目根**无任何代码规范工具配置**（CLAUDE.md 主动承认）
- **影响**：
  - 代码风格靠 commit 作者自觉，长期会分化
  - CI 不拦截明显 anti-pattern（未使用变量、any 滥用、console.* 残留）
- **推荐方案**：**biome**（Rust 写的，极快，单二进制，零依赖）
  - 比 ESLint 快 10-100x
  - 同时支持 lint + format
  - 配置简单
- **新增**：
  - `biome.json`（基础规则集 + 缩进/引号/分号）
  - `scripts.lint`: `biome lint packages/`
  - `scripts.format`: `biome format --write packages/`
  - `scripts.check`: `biome check packages/`
  - CI 加 step：`bunx @biomejs/biome check packages/`
- **工时**：3 小时
- **verify**：`bun run check` 通过 + CI step 通过

#### P1-3. tsconfig 严格度不足
- **位置**：`tsconfig.json`
- **现状**：只开 `strict: true`
- **缺失**：
  - `noUncheckedIndexedAccess`：数组/对象下标访问返回 `T | undefined`，防止越界
  - `exactOptionalPropertyTypes`：`{ x?: T }` 与 `{ x: T | undefined }` 严格区分
  - `noImplicitOverride`：子类 override 必须显式标注
  - `noFallthroughCasesInSwitch`：switch case 必 break
  - `noPropertyAccessFromIndexSignature`：索引签名必须 `[]` 而非 `.`
  - `noImplicitReturns`：函数所有分支必返回
- **影响**：开启后**会暴露一批潜在 bug**，需要配合修代码；属于质量债
- **建议**：**渐进式**，分 3 个 PR
  - PR1：`noFallthroughCasesInSwitch` + `noImplicitReturns`（零成本）
  - PR2：`noUncheckedIndexedAccess`（需要批量处理越界）
  - PR3：`exactOptionalPropertyTypes`（影响面最大，最后做）
- **工时**：合计 1-2 天
- **verify**：`bunx tsc --noEmit --skipLibCheck` 持续 0 错

#### P1-4. vitest 无覆盖率阈值
- **位置**：`vitest.config.ts`
- **现状**：只配 alias，无 `test.coverage.thresholds`
- **影响**：覆盖率自由落体无人察觉；CI 不拦截
- **修复**：
  ```ts
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      thresholds: {
        lines: 50,
        functions: 50,
        branches: 40,
        statements: 50,
      },
    },
  }
  ```
- **工时**：30 分钟
- **verify**：`bun run test:coverage` 阈值不通过则 exit 1

#### P1-5. 缺 release / publish workflow
- **位置**：`.github/workflows/`
- **现状**：只有 `ci.yml`，无 `release.yml`
- **影响**：发版纯手工（手工 bump version + 手工 git tag + 手工 push + 手工 npm publish），易遗漏步骤
- **修复**：新建 `.github/workflows/release.yml`
  - trigger：push `v*` tag
  - jobs:
    1. checkout + setup-bun + `bun install --frozen-lockfile`
    2. `bunx tsc --noEmit --skipLibCheck`
    3. `bun test --run`
    4. `bun run build` → 产物检查
    5. （可选）`bun pm trust` + `npm publish`（需 `NPM_TOKEN` secret）
    6. create GitHub Release（带 CHANGELOG 节选）
- **工时**：半天
- **决策点**：
  - Q1：是否真要发到 npm？（个人项目可以只发 GitHub Release）
  - Q2：version bump 是手动（PR 改 package.json）还是自动（conventional commits）？

---

### 🔵 P2：优化（5 项，可选）

#### P2-1. README "monorepo" 是营销说法
- **位置**：`README.md:11`、`CLAUDE.md:23`
- **现状**：README 写"monorepo"，CLAUDE.md 主动承认"monorepo 但无 workspace 工具"
- **问题**：`package.json` 无 `workspaces` 字段，所有包共享 node_modules；技术上是**单包 + 内部目录**
- **影响**：用户期待 `packages/foo` 独立安装/版本，实际是耦合
- **建议**：
  - 短期：README 改 `monorepo` → `multi-module`（或 `modular monolith`）
  - 长期：真转 monorepo（用 bun workspaces 或 turborepo），独立版本
- **工时**：5 分钟（短期）

#### P2-2. docs/plans/roadmap.md 缺失
- **位置**：CLAUDE.md:177 提到 `docs/plans/roadmap.md`，但**文件不存在**
- **影响**：引用死链；新成员按 CLAUDE.md 找文档找不到
- **修复**：
  - 选项 A：补建 `roadmap.md`（提炼 production-gaps-2026-q3.md + 本审计的优先级）
  - 选项 B：CLAUDE.md 删除该引用，把 production-gaps-2026-q3.md 标记为 roadmap
- **建议**：选项 B（避免文档碎片化）
- **工时**：5 分钟

#### P2-3. silent-failures.md 行号已过期
- **位置**：`docs/silent-failures.md` 第 1、b、c 项行号
- **现状**：memory.ts 行号 57/108/136、loop.ts 行号 89/334 在文档中标注，但实际代码已演进（行号偏移）
- **影响**：review 时无法定位代码
- **修复**：用 `code_location`（文件名 + 函数名 + 上下文）替代行号，或者 grep 重生成
- **工时**：15 分钟

#### P2-4. CI 无 cache
- **位置**：`.github/workflows/ci.yml`
- **现状**：每次跑 `bun install` 都重新下载
- **影响**：CI 慢（~1-2 分钟浪费在 install 上）
- **修复**：加 `actions/cache` step 缓存 `~/.bun/install/cache`
- **工时**：10 分钟

#### P2-5. 缺 .editorconfig 在 CI 引用
- **现状**：`.editorconfig` 已存在（缩进/换行/UTF-8 配置正确），但**无人引用**
- **影响**：编辑器配置靠插件自觉；PR review 时空格/换行噪音
- **修复**：P1-2 引入 biome 后，biome 会接管格式化（覆盖 .editorconfig 范围），但保留 .editorconfig 作为 fallback

---

### ⚪ P3：远期（不在本期范围）

| 项 | 优先级 | 备注 |
|---|---|---|
| Dockerfile / 容器化 | P3 | 个人项目用 Bun 直接跑即可 |
| .env.example | P3 | licode.config.json.example 已覆盖 |
| .npmrc | P3 | 无特殊 registry 需求 |
| E2E test（spawn 子进程跑 dev）| P3 | CI 矩阵已覆盖单元/integration |
| Metrics / tracing | P3 | devLogger 已够用 |
| Plugin / extension 机制 | P3 | skills 系统已部分覆盖 |
| 国际化（错误信息中英混）| P3 | CLAUDE.md 已默认中文输出 |
| 自动 changelog（conventional commits）| P3 | 当前手工维护可接受 |

---

## 三、文件清单

### 新建
- `SECURITY.md`
- `biome.json`（P1-2）
- `packages/tools/__tests__/builtin-extended.test.ts`（P1-1）
- `.github/workflows/release.yml`（P1-5）

### 修改
- `README.md`（P0-1, P0-5, P2-1）
- `bunfig.toml`（P0-2）
- `package.json`（P0-3）
- `LICENSE`（P0-4）
- `CLAUDE.md`（P0-5, P2-2）
- `CHANGELOG.md`（P0-5，[Unreleased] 加 Sprint 2 条目）
- `tsconfig.json`（P1-3，分 3 个 PR）
- `vitest.config.ts`（P1-4）
- `.github/workflows/ci.yml`（P1-2 biome step，P2-4 cache）
- `docs/silent-failures.md`（P2-3）
- `package.json` scripts 加 `lint` / `format` / `check` / `typecheck`（P1-2）

### 不改（已 OK 或不在范围）
- `docs/plans/production-gaps-2026-q3.md`（事实正确，作为历史决策保留）
- `docs/silent-failures.md` 策略部分（仅行号过期）
- 工具源码（不重构，仅补测试）

---

## 四、执行顺序（Sprint 划分）

### Sprint 2：元数据 + 规范（1 天）— P0 全部 6 项
1. P0-1 README badge 修 → 2min
2. P0-2 bunfig preload 修 → 2min
3. P0-3 package.json 元数据补 → 5min
4. P0-4 LICENSE 作者名 → 1min
5. P0-5 工具数/provider 名对齐 → 10min
6. P0-6 SECURITY.md 新建 → 10min
7. P2-2 roadmap 引用清理（顺手）→ 5min
8. P2-3 silent-failures 行号刷新 → 15min
9. **verify**：`bunx tsc` + `bun test` + `git diff` 一致性检查

### Sprint 3：质量门禁（2-3 天）— P1 前 4 项
1. P1-2 引入 biome → 3h
2. P1-4 vitest 覆盖率阈值 → 30min
3. P1-3 tsconfig 严格化（先 PR1）→ 2h
4. P1-1 工具包 P0 工具测试 → 1.5 天（可与 P1-2/3/4 并行 worktree）

### Sprint 4：发版基建（半天-1 天）— P1-5 + P2-4
1. P1-5 release workflow → 半天
2. P2-4 CI cache → 10min
3. **决策点**：是否走 npm publish？

### Sprint 5（可选）：tsconfig 严格化深化
1. P1-3 PR2（noUncheckedIndexedAccess）
2. P1-3 PR3（exactOptionalPropertyTypes）

---

## 五、不做什么（明确排除）

| 项 | 原因 |
|---|---|
| HEADROOM Python 集成 | production-gaps q3 已决定归档 |
| 引入 DI 容器 | 单例够用 |
| 重写 LLM 抽象 | 4 provider + retry + fallback 已够用 |
| 添加工具 / provider / skill | 本期专注质量 |
| 移除 `simple-git` 依赖 | production-gaps P2-5 未做，工作量 30min 但优先级低 |
| 真转 monorepo（workspaces） | 单包够用，重构成本高 |
| 性能优化（hot path 重写） | tui-render-optimization.md 未实施但功能可接受 |
| 大规模测试（>60% 覆盖） | 关键路径覆盖即可 |

---

## 六、验收

完成后：

1. ✅ README badge 跳转 200
2. ✅ `bun test` 在 Windows 跑通（preload 修好）
3. ✅ `npm info licode` 显示完整元数据
4. ✅ LICENSE 写明真实作者
5. ✅ 三处文档工具数/provider 名一致
6. ✅ `SECURITY.md` 存在，GitHub Security tab 可读
7. ✅ `bun run check`（biome）通过
8. ✅ `bun run test:coverage` 阈值不通过则 exit 1
9. ✅ tsc 0 错（含新增严格选项）
10. ✅ tools 包测试 ≥ 30%
11. ✅ release workflow tag 触发可跑通（dry-run）
12. ✅ CI 加 cache，install < 30s
13. ✅ CHANGELOG [Unreleased] 加 Sprint 2 条目
14. ✅ 工作区干净

---

## 七、修订记录

| 日期 | 修订 | 作者 |
|---|---|---|
| 2026-06-24 | 初版：基于 q3 报告的事实纠错 + 6 P0 + 5 P1 + 5 P2 | Claude（补充审计）|
| 2026-06-25 | P0-5 节事实纠错：CHANGELOG 从未列过"34 工具"（原表写错），删除修复建议中的伪任务；production-gaps-2026-q3.md "34 工具" 加注脚说明为历史快照归档；verify grep 排除 archive/ 目录 | Claude（修正）|
