---
name: git-worktrees
description: worktree 隔离 —— feature / 调试隔离用，不污染主分支
---

# git-worktrees（worktree 隔离）

## 何时用

- 调试一个不确定能修好的问题（怕污染主分支）
- 大特性开发，需要独立环境
- 同时维护多个分支（hotfix + feature）
- 测试不同方案对比

**不要用于**：单文件小改（直接在主分支上）。

## 核心纪律

```
起 worktree 前先 commit 当前进度
完工后用 finishing-branch skill 整合
```

不要在 worktree 里 commit 后不切回主分支；不要忘了 worktree 路径在哪。

## 我们项目的步骤

1. **先 commit 当前进度**（CLAUDE.md 规范："在已有 .git 的文件夹操作文件前，先 git commit 保存原始状态"）。
2. **创建 worktree**：
   ```bash
   git -C <project> worktree add -b <branch> <project>/.worktrees/<topic> main
   ```
   - worktree 路径统一放 `<project>/.worktrees/<topic>`
   - 分支名用 kebab-case（`fix-login-bug`、`feat-export-csv`）
3. **进入 worktree 干活**：
   ```bash
   cd <project>/.worktrees/<topic>
   ```
4. **跟踪当前 worktree 状态**：
   ```bash
   git -C <project> worktree list
   ```
5. **完工后用 finishing-branch skill 整合**：merge / PR / 保留。
6. **清理 worktree**（merge 后）：
   ```bash
   git -C <project> worktree remove <project>/.worktrees/<topic>
   git -C <project> branch -d <branch>
   ```

## 反模式

- ❌ 不 commit 直接起 worktree（可能丢改动）
- ❌ worktree 路径乱放（统一 `.worktrees/<topic>`）
- ❌ 完工后忘了清理（垃圾 worktree 堆积）
- ❌ 在 worktree 里又起 worktree（嵌套混乱）
