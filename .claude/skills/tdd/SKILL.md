---
name: tdd
description: 测试驱动开发 —— red → green → refactor，一个垂直切片一个迭代
---

# tdd（测试驱动开发）

## 何时用

- 实现新功能（哪怕是单文件）
- 修 bug 后写 regression test
- 重构前先确保有测试覆盖
- 用户明确说"用 TDD 做"

**不要用于**：纯文档变更、纯配置变更、UI 调整。

## 核心纪律

```
red  → 写一个失败的测试（描述期望行为）
green → 写最小代码让测试通过
refactor → 在 green 基础上清理代码，不改行为
```

不要跳过 red 直接写实现；不要一次写一堆测试；不要在 refactor 阶段加新行为。

## 我们项目的步骤

1. **red**：写测试，运行 `pytest tests/path/test_x.py::test_y -v`，确认 FAIL。
2. **green**：写最小代码让测试通过，不追求优雅。
3. **refactor**：清理重复、提升命名、加类型注解。运行 `pytest` + `ruff check src/` 保持 green。
4. **提交**：`feat: <做了什么>`，commit message 中文。

## 测试规范

- **一个测试一个行为断言**（不要 `assert x == 1 and y == 2`）
- **测试名描述行为**：`test_<模块>_<场景>_<期望>`（如 `test_login_invalid_password_returns_401`）
- **不测实现细节**：测接口行为，不测私有方法
- **不依赖外部服务**：用 mock 或 fixture 隔离

## 反模式

- ❌ 一次写 5 个测试再写实现（应该 red-green-refactor 一个一个来）
- ❌ 测试只覆盖 happy path
- ❌ 重构时改行为（refactor 阶段不允许改行为）
- ❌ 跳过 red 步骤直接写实现
- ❌ 测试覆盖外部依赖（应 mock）
- ❌ 写完测试不跑就直接 commit
- ❌ 测试名描述实现而非行为（如 test_calculate 不如 test_returns_zero_for_empty_input）
- ❌ 用 time.sleep 等待异步结果（应用 mock 或 await）
