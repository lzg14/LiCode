# 修复：LLM 工具调用循环中中间文本与最终回复重复

## 原因

licode 的 LLM 调用流程是循环式的：`generateText` → 返回文本+工具调用 → 执行工具 → 再次 `generateText` → ... 直到无工具调用。

当前消息流转路径：

```
第1轮 LLM: text="我先读文件" + toolCalls=[read]
  → onStreamText("我先读文件")        → streamingText 信号（临时显示在底部）

工具执行: read package.json

第2轮 LLM: text="再编辑" + toolCalls=[edit]
  → onStreamText("再编辑")            → streamingText 追加

工具执行: edit package.json

第3轮 LLM: text="完成了" (无 toolCalls)
  → streamingText 显示 → 循环结束
  → fullText 累积了 "我先读文件再编辑完成了"
  → loop.tsx 把 fullText 添加为一条 assistant 消息
```

**问题**：streamingText 在循环期间显示了中间文本（"我先读文件"、"再编辑"），但这些文本在循环结束后被 `setStreamingText("")` 清除，然后 fullText（全部累积文本）作为一条最终 assistant 消息添加到消息列表。

**结果**：用户看到的顺序是：
1. streamingText 显示中间过程（临时）
2. 工具调用出现在消息列表
3. 最终 assistant 消息包含所有中间文本的拼接

视觉上就是：工具调用显示在"上面"，文本回复在"下面"。而且如果中间文本和最终文本有重叠，会出现重复。

## 改动

在 `execute.ts` 的工具调用循环中，每次 LLM 返回文本+工具调用时，通过新回调 `onIntermediateText` 把该轮文本保存为独立 assistant 消息。最后一轮无工具调用时也保存。返回空字符串防止 loop.tsx 再添加重复的最终消息。DB 持久化逻辑不变。

涉及文件：
- `packages/core/phases/execute.ts` — 新增 `onIntermediateText` 回调，修改返回逻辑
- `packages/core/loop.ts` — LoopContext 接口新增字段 + 透传
- `packages/tui/context/loop.tsx` — 实现回调：保存消息 + 清空 streaming

## 弊端

1. **DB 与 TUI 显示不一致**：DB 存的是累积 fullText（一条完整消息），TUI 显示的是分段消息。跨启动恢复时历史消息是一条长文本而不是分段。
2. **最后一轮的 streaming 体验变化**：之前最后一轮文本会先在 streaming 区域逐渐显示，然后合并到消息列表。现在中间文本直接作为消息添加，streaming 区域可能只显示很短时间。
3. **消息列表变长**：每次工具调用都产生一条 assistant 消息，5 轮工具调用 = 5 条 assistant 消息 + 对应的工具调用消息。消息列表会比之前长很多。
