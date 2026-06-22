---
name: finishing-branch
description: 完工后整合 —— merge / PR / 保留 三选一时给出利弊
---

# finishing-branch（完工整合）

## 何时用

- 当前分支任务全部完成
- 准备结束一段开发工作
- 决定怎么把改动合到主分支

**不要用于**：还在开发中、verification 没跑过。

## 核心纪律

```
验证 → 选择 → 执行
```

不要跳过 verification 直接 push。

## 三个选项（按场景）

### A. 直接 merge（自己项目的本地分支）

**适合**：
- 个人项目
- 改动小、风险低
- 没有 code review 流程

**做法**：
```bash
git -C <path> checkout main
git -C <path> merge --no-ff <branch>
git -C <path> branch -d <branch>
```

### B. 提 PR（团队项目 / 需 review）

**适合**：
- 团队项目
- 改动较大
- 需 CI 通过 + 同事 review

**做法**：
1. 先跑 verification skill 全套检查。
2. `git push -u origin <branch>`（**需用户确认**，CLAUDE.md 规范）。
3. 用 `gh pr create --title "<title>" --body "<body>"`。
4. PR body 包含：背景 / 改动清单 / 测试证据 / UI 截图（如有）。
5. 等 review、merge。

### C. 保留分支（不急合）

**适合**：
- 实验性改动，不确定要不要保留
- 等其他改动一起合

**做法**：分支留着，下次会话再用。

## 关键检查清单

- [ ] verification skill 全过
- [ ] `git status` 无未追踪文件
- [ ] commit 信息规范（feat/fix/... 标签）
- [ ] PR body 完整（如果是选项 B）
- [ ] **push 之前必须用户确认**（CLAUDE.md 规范）

## 反模式

- ❌ 跳过 verification 直接 merge
- ❌ 不经用户确认就 push
- ❌ PR body 只写"修改了一些东西"
- ❌ merge 后不删本地分支（垃圾分支堆积）
