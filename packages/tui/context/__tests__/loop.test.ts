import { describe, expect, test } from "bun:test"
import { appendFinalAssistantMessage } from "../loop"

describe("appendFinalAssistantMessage dedup", () => {
  // 回归：MAX_ITERATIONS 用尽时，最后一轮 tool_calls 的 result.text 会被
  // onIntermediateText + 这里重复加，导致"15/15 通过"之类的文本显示两次。
  test("最后一条 assistant 消息内容 === content 时，跳过不重复加", () => {
    const messages = [
      { id: "u1", role: "user", content: "run tests", timestamp: 1 },
      {
        id: "i1",
        role: "assistant",
        content: "15/15 通过",
        timestamp: 2,
        duration: 5,
      },
    ]
    const result = appendFinalAssistantMessage(messages, "15/15 通过", 6000)
    expect(result).toBe(messages) // 引用相等，跳过
    expect(result.length).toBe(2)
  })

  test("最后一条 assistant 消息内容 !== content 时，正常添加", () => {
    const messages = [
      { id: "u1", role: "user", content: "run tests", timestamp: 1 },
      { id: "i1", role: "assistant", content: "中间文本", timestamp: 2 },
    ]
    const result = appendFinalAssistantMessage(messages, "15/15 通过", 6000)
    expect(result.length).toBe(3)
    expect(result[2].role).toBe("assistant")
    expect(result[2].content).toBe("15/15 通过")
    expect(result[2].duration).toBe(6)
  })

  test("最后一条不是 assistant 时，正常添加（自然结束场景）", () => {
    const messages = [
      { id: "u1", role: "user", content: "hi", timestamp: 1 },
      { id: "t1", role: "tool", content: "bash", timestamp: 2 },
    ]
    const result = appendFinalAssistantMessage(messages, "你好", 3000)
    expect(result.length).toBe(3)
    expect(result[2].role).toBe("assistant")
    expect(result[2].content).toBe("你好")
  })

  test("messages 为空数组时，正常添加第一条", () => {
    const result = appendFinalAssistantMessage([], "first", 1000)
    expect(result.length).toBe(1)
    expect(result[0].role).toBe("assistant")
    expect(result[0].content).toBe("first")
    expect(result[0].duration).toBe(1)
  })

  test("最后一条 content 包含 content 但不完全相等时，仍添加（不误判）", () => {
    // 防止 "15/15 通过\n" vs "15/15 通过" 被误判为相同
    const messages = [
      {
        id: "i1",
        role: "assistant",
        content: "15/15 通过",
        timestamp: 2,
      },
    ]
    const result = appendFinalAssistantMessage(messages, "15/15 通过\n", 6000)
    expect(result.length).toBe(2) // 不算 dedup，正常加
    expect(result[1].content).toBe("15/15 通过\n")
  })
})