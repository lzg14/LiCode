> ⚠️ **本文档已完成（2026-06-21）**
>
> licode 直接消费 `~/.claude/skills/` 下的 SKILL.md，对齐 Claude Code 生态（commit `7357b00`）。
>
> 完整归档说明参见：[`docs/plans/archive/README.md`](./README.md)

# Claude Code Skills 集成计划

**目标**：licode 直接消费 `~/.claude/skills/` 下的 SKILL.md 文件，删除硬编码的 coding/research/review workflow 模板，对齐 Claude Code 生态。

**日期**：2026-06-21
**前置**：产品化阶段五已完成（commit 7357b00）

---

## 背景

用户已有 14 个 Claude Code skills 在 `C:\Users\lzg14\.claude\skills\`，格式为 `{name}/SKILL.md` + YAML frontmatter（`name`、`description` 字段）。

之前 licode 实现了 3 个 hardcoded workflow（coding/research/review）作为 system prompt 模板，但与 Claude Code 的 skill 机制重复且割裂。

**目标**：让 licode 直接读这些 .md 文件作为技能源，3 个 hardcoded workflow 删除。

---

## 步骤

- [ ] **Step 0：侦察现有 skill 机制**
  - 跑以下命令了解现有代码：
    ```bash
    grep -n "name: 'skill'" packages/tools/builtin.ts
    grep -rn "setActiveSkill\|activeSkillInstructions" packages/ --include="*.ts" --include="*.tsx"
    ls packages/skills/
    cat packages/skills/index.ts 2>&1
    ```
  - **verify**：能讲清楚现有 `skill` 工具如何加载技能 + `setActiveSkill` 流程

- [ ] **Step 1：实现 skill 加载器**
  - 新建 `packages/skills/loader.ts`，实现：
    - `interface Skill { name; description; content; path }`
    - `parseFrontmatter(raw)` — 解析 `---\n...\n---\n` 包裹的 YAML 简单子集（只取 `name`/`description`）
    - `loadSkillsFrom(dir)` — 从 `{dir}/{name}/SKILL.md` 加载所有 skill
    - `loadAllSkills(cwd?)` — 全局 `~/.claude/skills/` + 项目级向上找 `.claude/skills/`，合并去重（global 优先）
    - `findSkill(name, cwd?)` — 按名查找
  - **verify**：
    ```bash
    bun run -e 'import {loadAllSkills} from "./packages/skills/loader"; console.log(loadAllSkills().map(s=>s.name))'
    ```
    输出 14 个 skill 名

- [ ] **Step 2：扩展 `packages/skills/index.ts`**
  - re-export loader 导出的所有函数和类型
  - **verify**：`grep "export" packages/skills/index.ts` 包含 loader 的导出

- [ ] **Step 3：改造 `setActiveSkill`**
  - `packages/tui/context/loop.tsx` 中：
    - 删除 presetPrompt 相关所有代码（`presetPrompts` signal、`loadPresetPrompts()`、`runWorkflow()`、`listWorkflows()`）
    - 重写 `setActiveSkill(name: string | null)`：调用 `findSkill(name, process.cwd())`，找到则设置 `activeSkill(name)` + `activeSkillInstructions(skill.content)`，没找到则提示用户
    - 新增 `listSkills(): string[]` → `loadAllSkills(process.cwd()).map(s => s.name)`
  - **verify**：
    ```bash
    grep -n "presetPrompt\|runWorkflow\|listWorkflows\|loadPresetPrompts" packages/tui/context/loop.tsx
    ```
    输出为空

- [ ] **Step 4：`/skill` 命令替换 `/workflow`**
  - `packages/tui/routes/home.tsx` line 85 附近：
    - 删 `if (text.startsWith('/workflow') || text.startsWith('/wf'))` 判断
    - 改成 `if (text.startsWith('/skill') || text.startsWith('/workflow') || text.startsWith('/wf'))`（三选一都进入技能命令）
    - 解析参数：`/skill list` 列出可用技能；`/skill <name>` 激活；`/workflow <name>` 同理（向后兼容）
  - **verify**：手动跑 TUI，输 `/skill list` 看到 14 个 skill；输 `/workflow architecture` 能激活

- [ ] **Step 5：删除 hardcoded workflows**
  - 跑：
    ```bash
    rm -rf packages/workflow/
    ```
  - **verify**：
    ```bash
    ls packages/workflow/ 2>&1
    ```
    输出 `No such file or directory`

- [ ] **Step 6：清理 `execute.ts`**
  - `packages/core/phases/execute.ts`：
    - 删 `presetPrompt?: string | null` 字段（ExecuteContext 中）
    - 删 `let fullSystem = ctx.presetPrompt || SYSTEM_PROMPT` 逻辑
    - 保留 `activeSkillInstructions` 处理逻辑（之前已经存在）
  - **verify**：
    ```bash
    grep -n "presetPrompt" packages/core/phases/execute.ts
    ```
    输出为空

- [ ] **Step 7：更新 README**
  - `README.md`：
    - 删 "Workflow 模板" 那一行
    - 加 "Skill 系统" 一行（措辞参考 Claude Code）
  - **verify**：`grep -n "workflow\|skill" README.md` 业务描述符合

- [ ] **Step 8：更新 CHANGELOG**
  - `CHANGELOG.md` 在 `## [Unreleased]` 区块加：
    ```markdown
    ### 重构
    - **Skill 集成**：从 Claude Code `~/.claude/skills/` 直接加载 SKILL.md 作为 licode 技能，删除硬编码的 coding/research/review workflow 模板。`/skill` 命令可用（`/workflow` 保留为别名，向后兼容）。
    ```
  - **verify**：`grep "Skill 集成" CHANGELOG.md` 有匹配

- [ ] **Step 9：验收**
  - 跑完整流程：
    ```bash
    # 1. 编译通过（除历史 integration 测试错外，无新错）
    bunx tsc --noEmit --skipLibCheck

    # 2. 测试通过
    bun test packages/skills 2>&1 | tail -5

    # 3. 端到端
    bun run dev
    # 手动测：
    #   - /skill list → 看到 14 个 skills
    #   - /skill architecture → 激活
    #   - /workflow architecture → 也工作
    #   - 发条消息 → system prompt 应包含 skill 内容

    # 4. 残留检查
    grep -rn "presetPrompt\|packages/workflow" packages/ docs/ README.md CHANGELOG.md
    ```
    期望：无业务代码引用残留

- [ ] **Step 10：提交**
  - 拆 2 个 commit：
    1. `feat: Claude Code skills 集成 + 删除 hardcoded workflows`
    2. `docs: 更新 README + CHANGELOG`
  - **verify**：`git log --oneline -3` 显示新提交

---

## 涉及文件清单

| 文件 | 操作 |
|---|---|
| `packages/skills/loader.ts` | 新建 |
| `packages/skills/index.ts` | 扩展 re-export |
| `packages/tui/context/loop.tsx` | 改 setActiveSkill + 加 listSkills，删 presetPrompt 相关 |
| `packages/tui/routes/home.tsx` | `/workflow` → `/skill`（保留别名） |
| `packages/core/phases/execute.ts` | 删 presetPrompt 字段 |
| `packages/workflow/` 整个目录 | 删 |
| `README.md` | 更新 |
| `CHANGELOG.md` | 加 Unreleased 条目 |

---

## 不做的事

| 不要做 | 原因 |
|---|---|
| 不要新建 skill 加载机制 | 现有 `setActiveSkill` 和 `activeSkillInstructions` 已存在，复用 |
| 不要保留 `/workflow` 和 `/skill` 两套命令 | 选 `/skill`，`/workflow` 做别名 |
| 不要把 skill 写到代码常量里 | 用 .md 文件，未来用户也能加 |
| 不要碰 `setActiveSkill` 的内部 state 管理 | 只重写它的实现，state 复用 |
| 不要新建 `packages/skills/` 之外的目录 | 保持简单 |

---

## 关键技术细节

### Frontmatter 解析（宽松匹配）

```ts
function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!m) return { meta: {}, body: raw }
  const meta: Record<string, string> = {}
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.+)$/)
    if (kv) meta[kv[1]] = kv[2].trim()
  }
  return { meta, body: m[2] }
}
```

只解析 `name` 和 `description`，其它字段忽略。

### Skill 加载优先级

```
~/.claude/skills/  (global)
./.claude/skills/  (project, 向上找第一个)
└─ 合并去重，global 优先
```

### setActiveSkill 实现

```ts
const setActiveSkill = async (name: string | null) => {
  if (!name) {
    setActiveSkill(null)
    setActiveSkillInstructions(null)
    return
  }
  const skill = findSkill(name, process.cwd())
  if (!skill) {
    addMessage({ role: 'system', content: `未找到 skill: ${name}\n可用: ${listSkills().join(', ')}` })
    return
  }
  setActiveSkill(name)
  setActiveSkillInstructions(skill.content)
}
```

---

## 验收标准

完成后必须满足：

1. ✅ `bunx tsc --noEmit --skipLibCheck` 除历史错误外无新错
2. ✅ `bun test` 通过（除 1 个已知的 builtin.test.ts tool count 容错测试外）
3. ✅ TUI 中 `/skill list` 列出 14 个 Claude Code skills
4. ✅ `/skill architecture` 激活后，下一条消息的 system prompt 含 skill 内容
5. ✅ `/workflow architecture` 仍可工作（向后兼容）
6. ✅ `packages/workflow/` 目录不存在
7. ✅ `grep presetPrompt packages/` 无业务代码引用
8. ✅ README 和 CHANGELOG 同步更新
9. ✅ 至少 2 个 commit（功能 + 文档）

---

## 工作量估计

| 步骤 | 时间 |
|---|---|
| Step 0 | 5 分钟 |
| Step 1 | 20 分钟 |
| Step 2 | 5 分钟 |
| Step 3 | 15 分钟 |
| Step 4 | 10 分钟 |
| Step 5 | 1 分钟 |
| Step 6 | 5 分钟 |
| Step 7 | 5 分钟 |
| Step 8 | 5 分钟 |
| Step 9 | 10 分钟 |
| Step 10 | 5 分钟 |
| **合计** | **约 90 分钟** |