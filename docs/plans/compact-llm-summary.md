# /compact LLM 总结改进计划

**目标**：将 `/compact` 改为以 **LLM 总结为主**（用户看到的就是 LLM 生成的连贯摘要），规则提取降为降级方案。

**日期**：2026-06-22
**前置**：当前 `session-compactor.ts` 实现已摸清

---

## 根因

当前流程：
```
extractRules() → buildFallbackSummary() → 用户看到 bullet 列表
     ↓（异步后台）
refineWithLLM() → 用户看不到（除非手动刷新）
```

问题：
1. **用户看到的是规则提取的 bullet**，不是 LLM 总结
2. **LLM 精炼是静默失败**（`.catch(() => {})`），用户无感知
3. **摘要信息量低**：前80字意图、文件路径列表，不够"理解对话在做什么"

---

## 目标效果

```
用户按 /compact
↓
LLM 生成连贯摘要（"今天我们重构了 packages/core 模块，引入了 checkpoint 机制，
修复了 streaming 崩溃问题..."）
↓
摘要展示给用户（TUI 显示 toast 或消息）
↓
摘要注入后续上下文，继续对话
```

---

## 步骤

### Phase 1：重构 compact 主流程

- [ ] **Step 1：重写 `compact()` 方法为主动式 LLM 调用**
  ```ts
  // session-compactor.ts
  async compact(
    messages: any[],
    sessionId: string,
    llm: { complete: (req: any) => Promise<any> },
  ): Promise<CompactionResult> {
    // 1. 构建摘要 prompt
    const prompt = this.buildSummaryPrompt(messages)
    
    // 2. 同步调用 LLM（不再后台异步）
    let summary: string
    try {
      summary = await this.summarizeWithLLM(prompt, llm)
    } catch (e) {
      // 3. 降级：规则提取
      summary = this.buildFallbackSummary(this.extractRules(toCompact))
      // 展示降级原因
    }
    
    // 4. 保存 + 返回
    this.saveSummary(sessionId, summary)
    return { summary, summaryPath, ... }
  }
  ```
  - 文件：`packages/core/session-compactor.ts`
  - **verify**：手动 `/compact`，TUI 显示 LLM 生成的连贯段落（非 bullet）

### Phase 2：重写 `summarizeWithLLM`

- [ ] **Step 2：重写 `summarizeWithLLM()`**
  ```ts
  private async summarizeWithLLM(
    messages: any[],
    llm: { complete: (req: any) => Promise<any> },
  ): Promise<string> {
    // 把消息格式化为简洁的对话记录
    const conversationText = this.formatMessagesForSummary(messages)
    
    const prompt = `你是一个对话摘要助手。请根据以下对话记录，写一段 3-5 句的连贯摘要，
说明：1）做了什么任务 2）有什么技术决策 3）项目当前状态。
直接输出摘要正文，不要前缀说明。

## 对话记录
${conversationText}`
    
    const response = await llm.complete({
      model: '',  // 用当前配置的模型
      messages: [
        { role: 'system', content: '你是对话摘要助手，直接输出摘要正文。' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      maxTokens: 600,
    })
    
    return response.content ?? ''
  }
  ```
  - **verify**：单测 mock LLM 返回，验证摘要格式

### Phase 3：优化 `formatMessagesForSummary`

- [ ] **Step 3：重写 `formatMessagesForSummary()` 格式化消息**
  - 保留：用户意图（截断到 200 字）、assistant 关键回复（截断到 300 字）
  - 去除：tool-call 参数细节、冗余的 thinking 内容
  - 格式：`[用户]: ...\n[助手]: ...\n[工具]: ...`
  - 文件：`packages/core/session-compactor.ts`
  - **verify**：写单测验证格式输出

### Phase 4：降级保留 + 用户感知

- [ ] **Step 4：保留规则提取为降级方案，但展示给用户**
  ```ts
  // 降级时返回更友好的提示
  if (llmFailed) {
    summary = this.buildFallbackSummary(extraction)
    // 返回时附带 wasFallback: true，让 TUI 显示提示
    return { summary, wasFallback: true, ... }
  }
  ```
  - **verify**：mock LLM 失败，验证降级路径 + toast 提示

### Phase 5：TUI 展示摘要

- [ ] **Step 5：TUI 显示压缩结果通知**
  - 用户按 `/compact` 后，TUI 显示 toast：`已压缩 N 条历史，摘要：...`
  - 如果是 LLM 生成，显示 `[LLM 摘要]`
  - 如果是降级，显示 `[规则提取]（LLM 不可用）`
  - 文件：`packages/tui/context/loop.tsx` 的 `compactSession` 调用处
  - **verify**：手动 `/compact`，观察通知内容

### Phase 6：测试 + 文档

- [ ] **Step 6：写单测**
  - `packages/core/__tests__/session-compactor.test.ts`
  - case：正常 LLM 总结、降级路径、消息格式化、空消息
  - **verify**：`bun test packages/core` 全过

- [ ] **Step 7：更新 CHANGELOG**
  - Unreleased：`/compact 改用 LLM 生成连贯摘要，规则提取降为降级方案`

- [ ] **Step 8：commit**
  - `feat: /compact 改用 LLM 总结为主`

---

## 不做什么

| 项 | 原因 |
|---|---|
| 不改变压缩触发阈值 | 那是 next-improvements 阶段二的事 |
| 不改动摘要持久化格式 | 现有文件格式够用 |
| 不在压缩时删除消息 | SQLite 保留完整历史 |

---

## 验收

完成后：
1. ✅ `/compact` 显示 LLM 生成的连贯段落（3-5 句）
2. ✅ LLM 失败时展示规则提取 + 友好提示
3. ✅ 单测覆盖：正常/降级/格式化/空消息
4. ✅ TUI 有压缩结果通知
5. ✅ `bun test` 全过

---

## 工作量

| 步骤 | 时间 |
|---|---|
| Phase 1-2（核心重构） | 1 小时 |
| Phase 3（格式化） | 30 分钟 |
| Phase 4（降级） | 30 分钟 |
| Phase 5（TUI） | 30 分钟 |
| Phase 6（测试 + 文档） | 30 分钟 |
| **合计** | **约 3 小时** |

---

确认后发给 agent 执行。
