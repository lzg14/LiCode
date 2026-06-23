# Effort Level 路由

**版本**: v1.7.0
**日期**: 2026-06-17

## 1. 核心思想

不是每个任务都需要完整走 7 阶段。复杂任务走完整流程，简单任务走压缩路径。

```
用户输入 → 分类器 → 路由到不同路径
                    │
    ┌────────────────┼────────────────┐
    ↓                ↓                ↓
  E1 (Minimal)    E2-E3 (Normal)    E4-E5 (Complex)
    ↓                ↓                ↓
 Fast-path       Standard Loop    Full Algorithm
```

## 2. Effort Level 定义

| 等级 | 复杂度 | 场景示例 | 路径 |
|------|--------|---------|------|
| **E1** | Minimal | 简单命令、单工具调用、纯查询 | Fast-path |
| **E2** | Light | 简单修改、单文件、已知模式 | Standard |
| **E3** | Medium | 多文件修改、常规开发任务 | Standard + **需求确认** |
| **E4** | Deep | 架构变更、多系统协作 | Full Algorithm + **强制 Interview** |
| **E5** | Comprehensive | 关键系统变更、不可逆操作 | Full Algorithm + **完整 Interview** |

## 3. Mode 压缩路径

| Mode | 触发条件 | 阶段路径 |
|------|---------|---------|
| **Fast-path** | E1 + 单工具调用 | OBSERVE → EXECUTE → VERIFY |
| **Research** | E1/E2 + 分析/审查（无代码变更） | OBSERVE → THINK → EXECUTE → VERIFY → LEARN |
| **Standard** | 默认（E2-E3） | 完整 7 阶段 |
| **Full Algorithm** | E4-E5 | 完整 7 阶段 + ISA + 验证门禁 |

## 4. E1 判定规则（Fast-path）

满足以下任一条件 → Fast-path：
- 简单命令：`git status`、`ls -la`
- 单工具调用：直接可执行，无需推理
- 纯查询：无副作用，只读操作
- 用户明确说"快点"、"简单弄一下"

**最低 Effort Level 保护：**
- Fast-path 最高只能到 E1，即使用户说"快点"也不能绕过 E2+ 任务的完整流程
- 判定为 E2+ 的任务会强制走完整流程，即使用户说"快点"
- 防止复杂任务被错误降级

## 5. E4/E5 强制门禁

E4/E5 任务必须通过以下门禁才能进入 BUILD：

| 门禁 | 要求 |
|------|------|
| **需求理解（grill-me）** | **必须完整澄清需求**，一次只问一个问题，顺着设计树往下走，直到所有分支都理解 |
| **ISA 完整** | 12 个章节必须填充 |
| **ISC 数量** | E4 >= 128 条, E5 >= 256 条 |
| **Anti-criteria** | >= 1 条（必须识别 failure modes） |
| **审查通过** | Commit-Boundary Advisor 二次确认 |

## 6. ISA 的 12 个章节

| # | 章节 | 说明 |
|---|------|------|
| 1 | **Problem** | 问题定义 - 描述要解决的核心问题 |
| 2 | **Vision** | 愿景 - 描述目标状态是什么样子 |
| 3 | **Out of Scope** | 范围外 - 明确不包含的内容 |
| 4 | **Principles** | 设计原则 - 指导决策的原则 |
| 5 | **Constraints** | 约束条件 - 技术、时间、资源等约束 |
| 6 | **Goal** | 具体目标 - 可测量的目标 |
| 7 | **Criteria** | 验收标准 - 如何判断完成 |
| 8 | **Test Strategy** | 测试策略 - 如何验证 |
| 9 | **Features** | 功能列表 - 需要实现的功能 |
| 10 | **Decisions** | 决策记录 - 关键决策及理由 |
| 11 | **Changelog** | 变更记录 - 追踪变更历史 |
| 12 | **Verification** | 验证结果 - 实际验证的证据 |

## 7. ISC 数量标准来源

ISC（Ideal State Criteria）是验证的原子单元。E4/E5 对 ISC 数量的要求：
- **E4 >= 128 条**：深度任务需要详细分解，确保每个细节都被验证
- **E5 >= 256 条**：综合任务更复杂，需要更细致的分解

这是 PAI 的经验值，用于确保任务被充分拆解，避免遗漏关键验收点。
