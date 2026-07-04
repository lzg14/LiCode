import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

// 清理全局信号，避免被前置测试污染
beforeAll(async () => {
  const { setTodos } = await import("../todos")
  setTodos([])
})

afterEach(async () => {
  const { setTodos } = await import("../todos")
  setTodos([])
})

describe("todos signal", () => {
  it("初始状态为空数组", async () => {
    const { todos } = await import("../todos")
    expect(todos()).toEqual([])
  })

  it("setTodos 后状态更新", async () => {
    const { todos, setTodos } = await import("../todos")
    setTodos([{ id: "1", content: "test", status: "pending" }])
    expect(todos()).toHaveLength(1)
    expect(todos()[0].content).toBe("test")
  })
})

describe("shortcuts signal", () => {
  it("sidebarVisible 初始为 true", async () => {
    const { sidebarVisible } = await import("../shortcuts")
    expect(sidebarVisible()).toBe(true)
  })

  it("modelPickerOpen 初始为 false", async () => {
    const { modelPickerOpen } = await import("../shortcuts")
    expect(modelPickerOpen()).toBe(false)
  })
})

describe("parseImageRefs", () => {
  it("无图片引用时原样返回", async () => {
    const mod = await import("../loop")
    const result = mod.parseImageRefs("你好世界")
    expect(result.text).toBe("你好世界")
    expect(result.images).toEqual([])
  })

  it("替换图片引用为占位文本", async () => {
    const mod = await import("../loop")
    const result = mod.parseImageRefs("请看 @test.png 的内容")
    expect(result.text).toBe("请看 @test.png 的内容")
    expect(result.images).toEqual([])
  })
})
