# 同步 I/O 改异步计划

**目标**：消除 3 个文件中的同步 I/O 阻塞，改用 `node:fs/promises` 异步 API，避免阻塞 Bun 事件循环
**日期**：2026-08-01

## 前置

- 本计划是 `code-quality-improvement-plan.md` Step 9 的详细版
- 3 个文件共 33 处同步 I/O 调用需要转换
- 项目已有 `node:fs/promises` 使用先例（`memory/memory.ts`、`tools/builtin/fs.ts`、`core/checkpoint.ts`）

---

## 现状分析

### 总览

| 文件 | 同步调用数 | 包含函数已是 async？ | 上游调用方需改？ | 难度 |
|------|-----------|---------------------|-----------------|------|
| `packages/skills/loader.ts` | 12 | ✅ 全部已是 async | ❌ 不需要 | 🟢 Easy |
| `packages/core/session-compactor.ts` | 10 | 🟡 混合（3 个 sync 函数需改 async） | ✅ `loop.ts` + 测试需加 `await` | 🟡 Medium |
| `packages/session/memory.ts` | 11 | ❌ 全部 sync | ❌ 无生产调用方 | 🟡 Medium |

### `node:fs/promises` API 对应关系

| 同步 (`node:fs`) | 异步 (`node:fs/promises`) | 备注 |
|-------------------|--------------------------|------|
| `existsSync(path)` | `access(path)` + catch | 无 `exists()`，需封装 helper |
| `readFileSync(path, enc)` | `readFile(path, enc)` | 直接替换 |
| `writeFileSync(path, data, enc)` | `writeFile(path, data, enc)` | 直接替换 |
| `appendFileSync(path, data, enc)` | `appendFile(path, data, enc)` | 直接替换 |
| `mkdirSync(path, opts)` | `mkdir(path, opts)` | 直接替换 |
| `readdirSync(path, opts)` | `readdir(path, opts)` | 直接替换 |
| `statSync(path)` | `stat(path)` | 直接替换 |

**`existsSync` 替换方案**：封装通用 helper：

```ts
import { access } from 'node:fs/promises'
async function exists(path: string): Promise<boolean> {
  try { await access(path); return true } catch { return false }
}
```

---

## 步骤

### Step 1：转换 `packages/skills/loader.ts`（最容易，先上）

**改动范围**：1 文件，0 上游影响

**具体改动**：

1. 修改 import：`node:fs` 同步 API → `node:fs/promises` 异步 API
   ```ts
   // 旧
   import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
   // 新
   import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
   ```

2. 添加 `exists` helper 函数
   ```ts
   async function exists(path: string): Promise<boolean> {
     try { await access(path); return true } catch { return false }
   }
   ```

3. 逐个替换 12 处调用：

   | 行 | 旧 | 新 |
   |---|---|---|
   | 41 | `existsSync(dir)` | `await exists(dir)` |
   | 42 | `mkdirSync(dir, { recursive: true })` | `await mkdir(dir, { recursive: true })` |
   | 49 | `readdirSync(dir, { withFileTypes: true })` | `await readdir(dir, { withFileTypes: true })` |
   | 53 | `existsSync(skillFile)` | `await exists(skillFile)` |
   | 62 | `readdirSync(dir)` | `await readdir(dir)` |
   | 78 | `existsSync(skillPath)` | `await exists(skillPath)` |
   | 81 | `readFileSync(skillPath, 'utf-8')` | `await readFile(skillPath, 'utf-8')` |
   | 106 | `existsSync(skillPath)` | `await exists(skillPath)` |
   | 109 | `readFileSync(skillPath, 'utf-8')` | `await readFile(skillPath, 'utf-8')` |
   | 169 | `mkdirSync(saveDir, { recursive: true })` | `await mkdir(saveDir, { recursive: true })` |
   | 174 | `writeFileSync(filepath, JSON.stringify(...))` | `await writeFile(filepath, JSON.stringify(...))` |
   | 209 | `existsSync(claudeSkills)` | `await exists(claudeSkills)` |

- verify: `bunx tsc --noEmit --skipLibCheck` 编译通过；`bun test packages/skills` 通过

---

### Step 2：转换 `packages/core/session-compactor.ts`

**改动范围**：1 文件 + `packages/core/loop.ts`（加 `await`）+ 测试文件

**具体改动**：

1. 修改 import：
   ```ts
   // 旧
   import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
   // 新
   import { access, appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
   ```

2. 添加 `exists` helper（同 Step 1）

3. 将 `loadLatestSummary()` 改为 async：
   ```ts
   // 旧
   private loadLatestSummary(sessionId: string): string | null {
   // 新
   private async loadLatestSummary(sessionId: string): Promise<string | null> {
   ```
   内部替换：
   - `existsSync(dir)` → `await exists(dir)`
   - `existsSync(p)` → `await exists(p)`
   - `readFileSync(latestPath, 'utf-8')` → `await readFile(latestPath, 'utf-8')`

4. 将 `hasSummary()` 改为 async：
   ```ts
   // 旧
   private hasSummary(sessionId: string): boolean {
   // 新
   private async hasSummary(sessionId: string): Promise<boolean> {
   ```
   内部替换：
   - `existsSync(dir)` → `await exists(dir)`
   - `existsSync(join(dir, 'summary-v1.md'))` → `await exists(join(dir, 'summary-v1.md'))`

5. 将 `saveSummary()` 改为 async：
   ```ts
   // 旧
   private saveSummary(sessionId: string, summary: string): string {
   // 新
   private async saveSummary(sessionId: string, summary: string): Promise<string> {
   ```
   内部替换：
   - `existsSync(dir)` → `await exists(dir)`
   - `mkdirSync(dir, { recursive: true })` → `await mkdir(dir, { recursive: true })`
   - `existsSync(join(...))` → `await exists(join(...))`
   - `writeFileSync(filePath, summary, 'utf-8')` → `await writeFile(filePath, summary, 'utf-8')`
   - `appendFileSync(accumPath, ...)` → `await appendFile(accumPath, ...)`

6. 更新 `packages/core/loop.ts` 的调用方（4 处加 `await`）：

   | 行 | 旧 | 新 |
   |---|---|---|
   | ~315 | `this.sessionCompactor.hasSummary(ctx.sessionId)` | `await this.sessionCompactor.hasSummary(ctx.sessionId)` |
   | ~328 | `this.sessionCompactor.loadLatestSummary(ctx.sessionId)` | `await this.sessionCompactor.loadLatestSummary(ctx.sessionId)` |
   | ~341 | `this.sessionCompactor.hasSummary(ctx.sessionId)` | `await this.sessionCompactor.hasSummary(ctx.sessionId)` |
   | ~342 | `this.sessionCompactor.loadLatestSummary(ctx.sessionId)` | `await this.sessionCompactor.loadLatestSummary(ctx.sessionId)` |

7. 更新测试文件 `packages/core/__tests__/session-compactor.test.ts`：
   - `loadLatestSummary(...)` → `await loadLatestSummary(...)`
   - `hasSummary(...)` → `await hasSummary(...)`

- verify: `bunx tsc --noEmit --skipLibCheck` 编译通过；`bun test packages/core` 通过

---

### Step 3：转换 `packages/session/memory.ts`

**改动范围**：1 文件 + 测试文件（无生产调用方）

**具体改动**：

1. 修改 import：
   ```ts
   // 旧
   import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
   // 新
   import { access, readdir, readFile, stat } from 'node:fs/promises'
   ```

2. 添加 `exists` helper（同上）

3. 将 `collectFiles()` 改为 async：
   ```ts
   // 旧
   private collectFiles(dir: string, extensions: string[]): string[] {
   // 新
   private async collectFiles(dir: string, extensions: string[]): Promise<string[]> {
   ```
   内部 `walk()` 也改为 async 递归：
   ```ts
   async function walk(current: string): Promise<void> {
     const entries = await readdir(current)
     for (const entry of entries) {
       const fullPath = join(current, entry)
       const s = await stat(fullPath)
       if (s.isDirectory()) await walk(fullPath)
       else if (extensions.some(ext => entry.endsWith(ext))) files.push(fullPath)
     }
   }
   ```
   替换：
   - `existsSync(dir)` → `await exists(dir)`
   - `readdirSync(current)` → `await readdir(current)`
   - `statSync(fullPath)` → `await stat(fullPath)`

4. 将 `searchMemory()` 改为 async：
   ```ts
   // 旧
   export function searchMemory(...): MemoryEntry[] {
   // 新
   export async function searchMemory(...): Promise<MemoryEntry[]> {
   ```
   替换：
   - `existsSync(root)` → `await exists(root)`
   - `existsSync(globalDir)` → `await exists(globalDir)`
   - `existsSync(projectDir)` → `await exists(projectDir)`
   - `readFileSync(filePath, 'utf-8')` → `await readFile(filePath, 'utf-8')`
   - `collectFiles(...)` → `await collectFiles(...)`

5. 将 `getRecentMemoryEntries()` 改为 async：
   ```ts
   // 旧
   export function getRecentMemoryEntries(...): MemoryEntry[] {
   // 新
   export async function getRecentMemoryEntries(...): Promise<MemoryEntry[]> {
   ```
   内部 `walk()` 同样改为 async 递归。
   替换：
   - `existsSync(root)` → `await exists(root)`
   - `readdirSync(dir)` → `await readdir(dir)`
   - `statSync(fullPath)` → `await stat(fullPath)`
   - `readFileSync(r.path, 'utf-8')` → `await readFile(r.path, 'utf-8')`

6. 更新测试文件 `packages/session/__tests__/session.test.ts`：
   - `searchMemory(...)` → `await searchMemory(...)`
   - `getRecentMemoryEntries(...)` → `await getRecentMemoryEntries(...)`

7. 更新导出类型：`packages/session/index.ts` 无需改动（`export * from './memory'` 自动传播新签名）

- verify: `bunx tsc --noEmit --skipLibCheck` 编译通过；`bun test packages/session` 通过

---

### Step 4：提取 `exists` helper 到共享位置

**改动范围**：新建 1 文件 + 3 文件 import 更新

3 个文件各自定义了同名的 `exists` helper，提取到共享位置避免重复：

1. 新建 `packages/core/utils/fs.ts`：
   ```ts
   import { access } from 'node:fs/promises'

   /** 异步版 existsSync：检查路径是否可访问 */
   export async function exists(path: string): Promise<boolean> {
     try { await access(path); return true } catch { return false }
   }
   ```

2. 在 Step 1/2/3 的三个文件中，改为 `import { exists } from '../core/utils/fs'`（或相对路径）

- verify: `bunx tsc --noEmit --skipLibCheck` 编译通过

---

## 不做什么

| ❌ | 原因 |
|---|---|
| 改 `detect-project.ts` | 其 sync I/O（`existsSync`/`readFileSync`）在启动时一次性调用，非热路径 |
| 改 `packages/memory/memory.ts` | 已使用 `node:fs/promises`，无需改 |
| 用 `Bun.file().exists()` | 与项目现有 `node:fs/promises` 风格不一致 |
| 全部消除 `existsSync` | 有些场景（如条件初始化）sync 更合适，只改热路径 |

---

## 执行顺序

```
Step 1 (loader.ts)     ← 最简单，0 上游影响
  ↓
Step 2 (session-compactor) ← 需要 loop.ts 跟进
  ↓
Step 3 (memory.ts)     ← 无生产调用方，独立
  ↓
Step 4 (共享 exists)   ← 去重复
```

Step 1/3 可并行；Step 2 依赖 Step 1 的 `exists` helper 模式（先跑一个确定模式）；Step 4 在全部完成后做。

---

## 风险

| 风险 | 缓解 |
|------|------|
| `existsSync` → `access` + catch 语义差异 | `access` 检查可访问性而非存在性，但对本项目场景（文件/目录是否存在）等价 |
| `loadLatestSummary` 签名变 async 导致类型不兼容 | 所有调用方都在 async 上下文中，加 `await` 即可 |
| `memory.ts` 的 `walk()` 改 async 递归可能栈深 | Bun 对 async/await 优化好，记忆文件数量有限（<1000），不会栈溢出 |
| 并发文件操作竞态 | 原有同步代码也存在竞态（只是被同步阻塞掩盖），改为 async 不增加新竞态 |

---

## 验收标准

- [ ] `bunx tsc --noEmit --skipLibCheck` 编译通过
- [ ] `bun test` 全部通过（排除已知 flaky）
- [ ] 3 个文件中 `grep -c "Sync" ` 结果为 0（完全消除同步 I/O）
- [ ] `packages/core/utils/fs.ts` 存在且导出 `exists`
- [ ] 无新增 `any` 类型

---

## 相关文档

- [docs/plans/code-quality-improvement-plan.md](./code-quality-improvement-plan.md) — 主计划 Step 9
- [packages/core/session-compactor.ts](../../packages/core/session-compactor.ts) — 压缩器
- [packages/skills/loader.ts](../../packages/skills/loader.ts) — Skill 加载器
- [packages/session/memory.ts](../../packages/session/memory.ts) — 记忆搜索
