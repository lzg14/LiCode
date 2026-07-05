# 项目检测器设计文档

**目标**：为 licode 项目设计项目感知模块（M2 智能增强），根据项目语言/框架/结构自动调整 system prompt 和工具行为

**日期**：2026-07-05

**详细设计**：v2 智能增强计划 `docs/plans/intelligence-enhancement-plan.md` §4.M2 + §2.3 + §3

---

## 1. 目标与边界

### 1.1 目标
- 自动检测项目**语言 / 框架 / 包管理器 / monorepo / 测试框架 / 代码规模 / 项目年龄**
- 输出结构化 `ProjectContext`，注入 system prompt
- 替代硬编码的"项目知识"，让 licode 在不同项目行为自适应

### 1.2 边界（与现有架构的关系）

| 来源 | 提供 | 不提供 |
|------|------|--------|
| **`CLAUDE.md`** | 项目规则（push 前 lint、测试命令、不建临时目录）| 动态检测（lockfile / 框架版本）|
| **M2 project-detector** | 动态检测（语言/包管理器/monorepo/test framework）| 静态项目规则（重复 CLAUDE.md 会双 source of truth）|
| **M3 style-analyzer** | 代码风格细节（缩进/命名/导入风格）| 项目类型检测 |
| **M1 hardware-detector** | 硬件 tier | 项目类型 |

**集成方式**：M2 输出 JSON，`system-prompt-builder` 把 CLAUDE.md 内容 + M2 dynamic 部分**合并注入**到 LLM context。

### 1.3 与 M3 关系
- M2 知道"这是 TypeScript 项目"
- M3 知道"项目用 2 空格缩进、double quote、显式 type"
- M2 粒度粗，M3 粒度细，两者互补

---

## 2. 核心模块设计

### 2.1 文件位置
```
packages/config/project-detector.ts      # 项目检测主体
packages/config/project-detector.test.ts # 测试
```

### 2.2 关键 TypeScript Interface

```typescript
export interface ProjectContext {
  /** 项目根路径 */
  root: string

  /** 主要编程语言 */
  language: 'typescript' | 'javascript' | 'python' | 'go' | 'rust' | 'unknown'

  /** 语言版本（package.json 的 engines.node，pyproject.toml 的 python 等）*/
  languageVersion?: string

  /** 前端框架（如有）*/
  frontendFramework?: 'react' | 'vue' | 'solid' | 'svelte' | 'next' | 'nuxt' | 'unknown'

  /** 包管理器 */
  packageManager: 'bun' | 'pnpm' | 'npm' | 'yarn' | 'pip' | 'poetry' | 'cargo' | 'unknown'

  /** 是否 monorepo */
  isMonorepo: boolean

  /** monorepo 类型 */
  monorepoType?: 'pnpm-workspace' | 'turborepo' | 'nx' | 'lerna' | 'bun-workspaces'

  /** 测试框架 */
  testFramework: 'vitest' | 'jest' | 'mocha' | 'pytest' | 'go-test' | 'unknown'

  /** 代码规模（按 .ts/.js 统计）*/
  codeSize: {
    fileCount: number
    lineCount: number
  }

  /** 项目年龄（自首次 commit 起天数）*/
  projectAgeDays?: number

  /** 检测时间戳 */
  detectedAt: number
}

export interface ProjectDetectorOptions {
  /** 是否缓存（默认 true）*/
  cache?: boolean
  /** 缓存 TTL（默认 5 分钟）*/
  cacheTtlMs?: number
  /** 扫描深度限制（默认 3）*/
  scanDepth?: number
}
```

### 2.3 关键函数签名

```typescript
/** 同步检测（启动时调）*/
export function detectProject(root?: string, options?: ProjectDetectorOptions): ProjectContext

/** 清缓存（仅测试）*/
export function _resetProjectDetectorCache(): void
```

---

## 3. 检测维度与策略

### 3.1 编程语言

| 标识文件 | 推断语言 |
|---------|---------|
| `tsconfig.json` 或 `*.ts` | TypeScript |
| `package.json` 无 tsconfig 但有 `.js` | JavaScript |
| `pyproject.toml` / `setup.py` / `requirements.txt` | Python |
| `go.mod` | Go |
| `Cargo.toml` | Rust |

**优先级**：
1. tsconfig.json 存在 → TypeScript（即使也有 .py 文件）
2. 否则按"显式配置文件"（pyproject.toml > go.mod > Cargo.toml > .js/package.json）

### 3.2 前端框架

仅当 `package.json` 存在时检查 `dependencies`：

| 依赖 | 框架 |
|------|------|
| `react` | react |
| `vue` | vue |
| `solid-js` | solid |
| `svelte` | svelte |
| `next` | next |
| `nuxt` | nuxt |

CLI 工具（licode）**通常没有**前端框架 → 期望 `frontendFramework: undefined`。

### 3.3 包管理器

| 标识文件 | 包管理器 |
|---------|---------|
| `bun.lockb` / `bun.lock` | bun |
| `pnpm-lock.yaml` | pnpm |
| `yarn.lock` / `yarn.lock` | yarn |
| `package-lock.json` | npm |
| `Pipfile.lock` / `pyproject.toml` 含 `[tool.poetry]` | poetry |
| `requirements.txt` | pip |
| `Cargo.lock` | cargo |
| `go.sum` | go (内置) |

**优先级**：第一个匹配的为准。

### 3.4 Monorepo 检测

| 标识文件 / 配置 | monorepoType |
|----------------|--------------|
| `pnpm-workspace.yaml` | pnpm-workspace |
| `turbo.json` | turborepo |
| `nx.json` | nx |
| `lerna.json` | lerna |
| `package.json` 含 `workspaces` 字段 | bun-workspaces / npm-workspaces |

### 3.5 测试框架

| 标识文件 / 配置 | 框架 |
|----------------|------|
| `vitest.config.ts` / `package.json` 含 `vitest` | vitest |
| `jest.config.js` / `package.json` 含 `jest` | jest |
| `pytest.ini` / `pyproject.toml` 含 `pytest` | pytest |
| Go 文件含 `*_test.go` | go-test |

### 3.6 代码规模

```bash
# TS/JS 文件数（限制深度避免 10K 文件卡 30s+）
find . -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" \
  -not -path "./node_modules/*" -not -path "./dist/*" -not -path "./.git/*" \
  -maxdepth 5 | wc -l
```

**性能优化**：
- 限制 `-maxdepth 5`（避免 monorepo 嵌套）
- 缓存结果（5 分钟）
- 使用 `readdirSync + filter` 替代 `find` 子命令（跨平台）

### 3.7 项目年龄

```bash
# 首次 commit 时间戳
git log --reverse --format=%ct | head -1
```

转天数：`Math.floor((Date.now() - timestamp * 1000) / 86400000)`

**shallow clone 兼容性**：如果只有 ≤ 1 个 commit，fallback 到 "未知"（不报错）。

---

## 4. 缓存策略

### 4.1 缓存 key
- `projectRoot` 绝对路径

### 4.2 缓存 TTL
- 默认 5 分钟（项目结构变更不频繁）
- 文件 watch 触发时清缓存（未来工作）

### 4.3 失效场景
- 用户 `git pull` 后文件结构变化
- 当前不主动 watch，依赖 TTL

---

## 5. 集成点

### 5.1 启动时检测
```typescript
// packages/cli/index.ts (或主入口)
import { detectProject } from '@licode/config/project-detector'
const project = detectProject(process.cwd())
```

### 5.2 System prompt 注入
```typescript
// packages/core/system-prompt-builder.ts (新文件)
export function buildSystemPrompt(config: Config, project: ProjectContext, hardware: HardwareProfile): string {
  return [
    '# 静态项目规则（CLAUDE.md）',
    readFileSync('CLAUDE.md', 'utf-8'),
    '',
    '# 动态项目感知（M2）',
    `语言：${project.language}`,
    `包管理器：${project.packageManager}`,
    `测试：${project.testFramework}`,
    `代码规模：${project.codeSize.fileCount} 文件`,
    project.isMonorepo ? `Monorepo: ${project.monorepoType}` : '',
  ].filter(Boolean).join('\n')
}
```

### 5.3 与 packages/core/detect-project.ts 关系
- 当前可能存在旧 `detect-project.ts`（如果有）
- **v2 决策**：新 `project-detector.ts` 是 v2 唯一来源
- 旧文件保留以做 backward compat，v0.5.0 移除

---

## 6. 性能考虑

### 6.1 启动延迟目标
- M2 检测总耗时 < 200ms（理想 < 100ms）
- 包含 7 个维度的检测

### 6.2 优化策略
- 并行执行各维度（`Promise.all` 不可用，因为大多数是 `fs.statSync`）
- 用 `readdirSync + filter` 替代 `find` 子命令（节省 spawn 开销）
- `git log --reverse` 只在需要时跑（first call + cache）

### 6.3 大项目兼容
- `find -maxdepth 5` 限制深度
- `wc -l` 用 streaming 避免加载全部文件名到内存

---

## 7. 验证方法

### 7.1 单元测试
```bash
# 在 mock 项目根目录跑检测
bun test packages/config/__tests__/project-detector.test.ts
```

测试场景：
- TS + bun + vitest + 单 package
- TS + pnpm + vitest + pnpm-workspace
- Python + poetry + pytest
- Go + go-test
- 空目录（fallback 到 unknown）
- shallow git（无 age）
- 10K 文件 monorepo（< 200ms）

### 7.2 集成测试
```bash
# 在 licode 自身项目根跑
bun run packages/cli/index.ts
# 期望日志：[project] TypeScript + bun + vitest, 200 files
```

### 7.3 跨平台
- macOS / Linux / Windows 都要工作
- 用 `path.join` 不用字符串拼接

---

## 8. 风险点

来自 v2 plan §4.M2「v2 风险点」：

| 风险 | 缓解 |
|------|------|
| `find` 在 10K 文件 monorepo 卡 30s+ | 用 `readdirSync + filter`，限制 `maxdepth 5` |
| `git log --reverse` 在 shallow clone 不准 | fallback 到 "未知"，不报错 |
| 与 CLAUDE.md 双 source of truth | §1.2 明确边界（CLAUDE.md 静态 + M2 动态）|
| 10K+ 文件 monorepo 性能 | 缓存 + 深度限制 |
| 与 M3 style 重复 | §1.3 明确分工（M2 粗粒度，M3 细粒度）|

---

## 9. 不做什么

- ❌ 不做 git history 分析（除年龄外的 commit 信息）
- ❌ 不做 AST 解析（属于 M10 v2.0）
- ❌ 不做远程项目类型查询
- ❌ 不做 license 检测
- ❌ 不做 contributor 统计
- ❌ 不做 code coverage 报告
- ❌ 不做依赖漏洞扫描
- ❌ 不做 CI 集成状态检测

---

## 10. 实施步骤

| Step | 内容 | 估算 |
|------|------|------|
| 1 | 文件位置 + 基础 interface（ProjectContext）| 1 天 |
| 2 | 7 维度检测（语言/框架/包管理器/monorepo/test/size/age）| 2-3 天 |
| 3 | 缓存 + 性能优化 | 1 天 |
| 4 | 集成到 system-prompt-builder | 1 天 |
| 5 | 单元测试 + 集成测试 + 跨平台验证 | 2 天 |
| 6 | 文档 + 灰度开关 | 1 天 |
| **合计** | **8-9 天 ≈ 1.5-2 周** | |

**版本计划**：v0.4.3（Phase 2 实施）。

---

## 附录 A：参考实现

### A.1 detectProject 主体
```typescript
// packages/config/project-detector.ts
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { exists } from 'node:fs/promises'

let cached: { key: string; context: ProjectContext; ts: number } | null = null

export function detectProject(root = process.cwd(), opts: ProjectDetectorOptions = {}): ProjectContext {
  const cacheTtl = opts.cacheTtlMs ?? 5 * 60 * 1000
  if (cached?.key === root && Date.now() - cached.ts < cacheTtl) {
    return cached.context
  }

  const context: ProjectContext = {
    root,
    language: detectLanguage(root),
    packageManager: detectPackageManager(root),
    isMonorepo: false,
    testFramework: 'unknown',
    codeSize: { fileCount: 0, lineCount: 0 },
    detectedAt: Date.now(),
  }

  context.frontendFramework = detectFrontendFramework(root)
  const mono = detectMonorepo(root)
  context.isMonorepo = mono.isMonorepo
  context.monorepoType = mono.type
  context.testFramework = detectTestFramework(root)
  context.codeSize = countCodeSize(root, opts.scanDepth ?? 3)
  context.projectAgeDays = detectProjectAge(root) ?? undefined

  cached = { key: root, context, ts: Date.now() }
  return context
}
```

### A.2 语言检测
```typescript
function detectLanguage(root: string): ProjectContext['language'] {
  if (existsSync(join(root, 'tsconfig.json'))) return 'typescript'
  if (existsSync(join(root, 'package.json'))) return 'javascript'
  if (existsSync(join(root, 'pyproject.toml')) || existsSync(join(root, 'setup.py'))) return 'python'
  if (existsSync(join(root, 'go.mod'))) return 'go'
  if (existsSync(join(root, 'Cargo.toml'))) return 'rust'
  return 'unknown'
}
```

### A.3 包管理器
```typescript
function detectPackageManager(root: string): ProjectContext['packageManager'] {
  if (existsSync(join(root, 'bun.lockb')) || existsSync(join(root, 'bun.lock'))) return 'bun'
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn'
  if (existsSync(join(root, 'package-lock.json'))) return 'npm'
  if (existsSync(join(root, 'Cargo.lock'))) return 'cargo'
  if (existsSync(join(root, 'go.sum'))) return 'go'
  return 'unknown'
}
```

### A.4 代码规模（流式，避免大项目卡）
```typescript
function countCodeSize(root: string, maxDepth: number): ProjectContext['codeSize'] {
  const targets = ['.ts', '.tsx', '.js', '.jsx']
  const ignore = ['node_modules', 'dist', '.git', 'coverage', '.next', 'build']
  let count = 0

  function walk(dir: string, depth: number) {
    if (depth > maxDepth) return
    let entries: string[]
    try { entries = readdirSync(dir) } catch { return }
    for (const e of entries) {
      if (ignore.includes(e)) continue
      const full = join(dir, e)
      let isDir: boolean
      try { isDir = statSync(full).isDirectory() } catch { continue }
      if (isDir) walk(full, depth + 1)
      else if (targets.some(t => e.endsWith(t))) count++
    }
  }

  walk(root, 0)
  return { fileCount: count, lineCount: 0 } // lineCount 跳过（成本高）
}
```

### A.5 项目年龄
```typescript
function detectProjectAge(root: string): number | null {
  try {
    const stdout = execFileSync(
      'git',
      ['log', '--reverse', '--format=%ct'],
      { cwd: root, encoding: 'utf-8', timeout: 3000 },
    )
    const firstLine = stdout.trim().split('\n')[0]
    if (!firstLine) return null
    const ts = Number.parseInt(firstLine, 10)
    if (Number.isNaN(ts)) return null
    return Math.floor((Date.now() - ts * 1000) / 86400000)
  } catch {
    return null
  }
}
```

---

## 附录 B：与 v2 plan 的对应

| v2 plan 章节 | 本 spec 对应 |
|------------|------------|
| §4.M2 主体 | §1 目标与边界 + §2 模块设计 + §3 检测策略 |
| §2.3 M2 与 CLAUDE.md 边界 | §1.2 边界 |
| §4.M2「v2 风险点」 | §8 风险点 |
| §6 Phase 2 实施计划 | §10 实施步骤 |
| §3 价值排序（M2 优先级）| §10 + 整体设计目标 |

---

## 修订历史

- **2026-07-05** — 初始设计 spec（与 v2 plan 同步）
