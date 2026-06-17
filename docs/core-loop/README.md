# licode Core Loop 设计文档

**版本**: v1.8.0
**日期**: 2026-06-17

---

## 核心理念

**宁可慢，不要白干。宁可多问，不要假设。**

- 不理解就反复问，直到理解清楚
- 不清楚就默认走完整流程
- 做出来发现不是想要的 = 垃圾 = 浪费

**强制理解原则**：
- E1/E2：影响范围明确，可以快速执行
- E3+：**强制需求澄清**，不理解不继续
- E4/E5：**强制 Interview**，必须完整理解才能动手

---

## 模块索引

| 文档 | 内容 |
|------|------|
| `20260617-effort-level.md` | Effort Level 路由、E1-E5 分级 |
| `20260617-seven-phase.md` | 七阶段循环、OBSERVE/THINK/PLAN/BUILD/EXECUTE/VERIFY/LEARN |
| `20260617-interview.md` | grill-me Interview、反向追问（Anti-criteria） |
| `20260617-context.md` | 上下文管理、Compaction、Memory Recall、Reasoning 压缩 |
| `20260617-multi-agent.md` | 多 Agent 协调、Task 生命周期、Session 嵌套 |
| `20260617-exception.md` | 异常处理、重试、降级 |

---

## 与其他 Agent 的差异

| 特性 | opencode | Claude Code | Pai |
|------|---------|------------|-----|
| **手动模式切换** | plan/build 模式 | 无 | 无（自动判断） |
| **Interview** | 无 | 无 | ✅ 内置追问 |
| **Anti-criteria** | 无 | 无 | ✅ 反向追问 |
| **Safe Boundary** | ✅ | 无 | ✅ 参考 opencode |
| **多话题隔离** | 无 | 无 | ✅ 消息标记 |
| **E1-E5 分级** | 无 | 无 | ✅ 自动路由 |
