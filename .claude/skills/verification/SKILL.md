---
name: verification
description: 完工前自证 —— 不展示证据不说"完成了"
---

# verification（完工自证）

## 何时用

- 准备说"完成了"或"修好了"之前
- 准备 commit / push 之前
- 准备交给用户验收之前

**铁律**：说"完成"之前必须展示证据。不接受"应该好了"、"看着没问题"。

## 核心纪律

```
evidence before assertions
```

## 我们项目的检查清单

每项必须实际跑过并贴出输出：

- [ ] **测试通过**：`pytest` 跑过，无 skip
- [ ] **lint 通过**：`ruff check src/` 无 warning
- [ ] **diff 范围**：`git diff --stat` 改动符合预期，没有顺手改无关文件
- [ ] **端到端**：关键路径手动跑过一次（不只是单测）
- [ ] **plan verify**：如果用了 planning skill，所有 verify check 都勾了
- [ ] **未追踪文件**：`git status` 无新增未追踪文件（除非是有意为之）
- [ ] **commit 信息**：用了 feat/fix/docs/refactor/test 标签，中文描述

## 怎么用

完成一个任务后，**逐项跑上面的检查**，把每项的输出贴出来。只有全部通过才说"完成"。

如果某项失败：
- 修复
- 重新跑全部检查（不要只跑一项）
- 再贴证据

## 反模式

- ❌ "代码改完了" 但没跑测试
- ❌ "我看了下应该没问题" —— 必须有命令输出
- ❌ 跑过测试但跳过 lint
- ❌ commit 信息写成"update"（没标签、没描述）
