---
name: writing-skills
description: 写 skill 的方法论 —— 小而精、可组合、复用现有 loop
---

# writing-skills（写 skill 的方法论）

## 何时用

- 准备新增一个 skill 到本 skill 库
- 重构现有 SKILL.md
- 评估是否要把一段工作流沉淀为 skill

**不要用于**：写普通代码、写普通文档。

## 核心纪律

```
触发清晰 → 纪律稳定 → 步骤具体 → 反模式防呆
```

不要写"什么都能用"的 skill —— SKILL.md 是给 agent 看的"何时调我"的说明书，不是百科全书。

## 我们项目的步骤

1. **确认价值**：写这个 skill 是为了复用一段反复出现的工作流吗？用一两次不算。
2. **看已有 skill**：先扫 `~/.claude/skills/` 和 `D:/ProjectFile/our-skills/references/skills/`，能不能扩展已有 skill 而不是新建。
3. **写 SKILL.md**（用 `C:/Users/lzg14/.claude/skills/<name>/SKILL.md` 模板）：
   - **frontmatter**：`name` + `description`（一句触发条件）
   - **何时用**：列出触发场景，不只是"做 X"而是"在 Y 情况下做 X"
   - **核心纪律**：取上游精华的不可变 loop
   - **我们项目的步骤**：用 CLAUDE.md / 工具栈的具体命令
   - **反模式**：防呆用
4. **控制在 100-200 行**：精简优先，不堆示例。
5. **实战跑一次**：找一个真实任务用这个 skill，看顺不顺。
6. **根据实战调整**：跑完发现步骤冗余或缺漏，改 SKILL.md。

## 模板

```markdown
---
name: <skill-name>
description: <一句话触发条件>
---

# <中文名>

## 何时用
- 触发场景清单

## 核心纪律
- 不可变 loop / 原则

## 我们项目的步骤
- 用 ruff / gh CLI / pyproject 等具体命令

## 反模式
- 不要做哪些事
```

## 评估标准（满足才值得建 skill）

- 这段工作流本月用了 ≥ 3 次
- 步骤有明确顺序（不是"看你情况"）
- agent 不容易自己想到这些步骤（需要提醒）

## 反模式

- ❌ skill 内容 > 300 行（太臃肿）
- ❌ "通用 skill"（啥都能用 = 啥都没用）
- ❌ 复刻上游 SKILL.md 不改本地化
- ❌ 写完不实战就定稿
