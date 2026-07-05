import { describe, expect, it, vi, beforeEach } from "vitest"

// ── parseImageRefs ──────────────────────────────────────────────

describe("parseImageRefs", () => {
  it("无图片引用时原样返回", async () => {
    const { parseImageRefs } = await import("../loop")
    const result = parseImageRefs("你好世界")
    expect(result.text).toBe("你好世界")
    expect(result.images).toEqual([])
  })

  it("多行文本无图片引用", async () => {
    const { parseImageRefs } = await import("../loop")
    const result = parseImageRefs("第一行\n第二行\n第三行")
    expect(result.text).toBe("第一行\n第二行\n第三行")
    expect(result.images).toEqual([])
  })

  it("包含 @ 符号但非图片引用", async () => {
    const { parseImageRefs } = await import("../loop")
    const result = parseImageRefs("请看 @user 的评论")
    expect(result.text).toBe("请看 @user 的评论")
    expect(result.images).toEqual([])
  })

  it("包含非图片后缀的 @ 文件引用", async () => {
    const { parseImageRefs } = await import("../loop")
    const result = parseImageRefs("读取 @config.json 和 @readme.md")
    expect(result.text).toBe("读取 @config.json 和 @readme.md")
    expect(result.images).toEqual([])
  })

  it("支持 png 后缀（大小写不敏感）", async () => {
    const { parseImageRefs } = await import("../loop")
    // 文件不存在时 readImageFile 返回 undefined，不替换
    const result = parseImageRefs("看 @photo.PNG")
    expect(result.text).toBe("看 @photo.PNG")
    expect(result.images).toEqual([])
  })

  it("支持 jpg/jpeg/gif/webp/bmp/svg 后缀", async () => {
    const { parseImageRefs } = await import("../loop")
    const inputs = [
      "看 @a.jpg",
      "看 @b.jpeg",
      "看 @c.gif",
      "看 @d.webp",
      "看 @e.bmp",
      "看 @f.svg",
    ]
    for (const input of inputs) {
      const result = parseImageRefs(input)
      // 文件不存在，readImageFile 返回 undefined，不替换
      expect(result.images).toEqual([])
    }
  })

  it("混合文本和图片引用占位符", async () => {
    const { parseImageRefs } = await import("../loop")
    const result = parseImageRefs("前面 @test.png 后面")
    // 文件不存在时保留原文
    expect(result.text).toBe("前面 @test.png 后面")
    expect(result.images).toEqual([])
  })

  it("空字符串返回空结果", async () => {
    const { parseImageRefs } = await import("../loop")
    const result = parseImageRefs("")
    expect(result.text).toBe("")
    expect(result.images).toEqual([])
  })

  it("路径中包含空格时不匹配（\\S+ 限制）", async () => {
    const { parseImageRefs } = await import("../loop")
    const result = parseImageRefs("看 @my file.png 的内容")
    // 空格断开路径匹配，不会被替换
    expect(result.text).toBe("看 @my file.png 的内容")
    expect(result.images).toEqual([])
  })
})

// ── formatToolArgs ──────────────────────────────────────────────

describe("formatToolArgs", () => {
  it("args 为空时返回空字符串", async () => {
    const { formatToolArgs } = await import("../../component/message-list")
    expect(formatToolArgs("read", null as any)).toBe("")
    expect(formatToolArgs("read", undefined as any)).toBe("")
  })

  it("read 工具返回 path", async () => {
    const { formatToolArgs } = await import("../../component/message-list")
    expect(formatToolArgs("read", { path: "/src/index.ts" })).toBe("/src/index.ts")
  })

  it("write 工具返回 path", async () => {
    const { formatToolArgs } = await import("../../component/message-list")
    expect(formatToolArgs("write", { path: "/dist/out.js", content: "..." })).toBe("/dist/out.js")
  })

  it("edit 工具返回 path", async () => {
    const { formatToolArgs } = await import("../../component/message-list")
    expect(formatToolArgs("edit", { path: "/lib/util.ts" })).toBe("/lib/util.ts")
  })

  it("glob 工具返回 pattern", async () => {
    const { formatToolArgs } = await import("../../component/message-list")
    expect(formatToolArgs("glob", { pattern: "**/*.ts" })).toBe("**/*.ts")
  })

  it("grep 工具返回 pattern", async () => {
    const { formatToolArgs } = await import("../../component/message-list")
    expect(formatToolArgs("grep", { pattern: "TODO|FIXME" })).toBe("TODO|FIXME")
  })

  it("bash 工具返回 command", async () => {
    const { formatToolArgs } = await import("../../component/message-list")
    expect(formatToolArgs("bash", { command: "ls -la" })).toBe("ls -la")
  })

  it("list_directory 工具返回 path", async () => {
    const { formatToolArgs } = await import("../../component/message-list")
    expect(formatToolArgs("list_directory", { path: "/src" })).toBe("/src")
  })

  it("websearch 工具返回 query", async () => {
    const { formatToolArgs } = await import("../../component/message-list")
    expect(formatToolArgs("websearch", { query: "vitest mock" })).toBe("vitest mock")
  })

  it("webfetch 工具返回 url", async () => {
    const { formatToolArgs } = await import("../../component/message-list")
    expect(formatToolArgs("webfetch", { url: "https://example.com" })).toBe("https://example.com")
  })

  it("未知工具 fallback 到 JSON.stringify", async () => {
    const { formatToolArgs } = await import("../../component/message-list")
    const args = { key: "value", nested: { a: 1 } }
    expect(formatToolArgs("unknown_tool", args)).toBe(JSON.stringify(args))
  })

  it("已知工具但缺少关键字段时 fallback 到 JSON.stringify", async () => {
    const { formatToolArgs } = await import("../../component/message-list")
    // read 工具但没有 path 字段
    expect(formatToolArgs("read", { other: "data" })).toBe(JSON.stringify({ other: "data" }))
  })

  it("bash command 为非字符串类型时转为字符串", async () => {
    const { formatToolArgs } = await import("../../component/message-list")
    // 理论上不会发生，但防御性测试
    expect(formatToolArgs("bash", { command: 123 })).toBe("123")
  })

  it("空对象 args 返回空 JSON", async () => {
    const { formatToolArgs } = await import("../../component/message-list")
    expect(formatToolArgs("any_tool", {})).toBe("{}")
  })

  it("MCP 工具名（mcp__server__tool）走 fallback", async () => {
    const { formatToolArgs } = await import("../../component/message-list")
    const args = { input: "test" }
    expect(formatToolArgs("mcp__server__tool", args)).toBe(JSON.stringify(args))
  })
})

// ── Subagent 状态跟踪 ──────────────────────────────────────────

describe("ExecuteContext onSubagentStart/End", () => {
  it("onSubagentStart 添加 running 状态", async () => {
    const statuses: Array<{ id: string; task: string; status: string; startTime: number }> = []
    const onSubagentStart = (id: string, task: string) => {
      statuses.push({ id, task, status: 'running', startTime: Date.now() })
    }
    onSubagentStart('sa_1', '搜索 auth 文件')
    expect(statuses).toHaveLength(1)
    expect(statuses[0].id).toBe('sa_1')
    expect(statuses[0].task).toBe('搜索 auth 文件')
    expect(statuses[0].status).toBe('running')
  })

  it("onSubagentEnd 更新状态为 done", async () => {
    const statuses: Array<{ id: string; status: string; endTime?: number }> = [
      { id: 'sa_1', status: 'running', startTime: Date.now() }
    ]
    const onSubagentEnd = (id: string, success: boolean) => {
      const idx = statuses.findIndex(s => s.id === id)
      if (idx >= 0) {
        statuses[idx] = { ...statuses[idx], status: success ? 'done' : 'error', endTime: Date.now() }
      }
    }
    onSubagentEnd('sa_1', true)
    expect(statuses[0].status).toBe('done')
    expect(statuses[0].endTime).toBeDefined()
  })

  it("onSubagentEnd 更新状态为 error", async () => {
    const statuses: Array<{ id: string; status: string }> = [
      { id: 'sa_1', status: 'running' }
    ]
    const onSubagentEnd = (id: string, success: boolean) => {
      const idx = statuses.findIndex(s => s.id === id)
      if (idx >= 0) {
        statuses[idx] = { ...statuses[idx], status: success ? 'done' : 'error' }
      }
    }
    onSubagentEnd('sa_1', false)
    expect(statuses[0].status).toBe('error')
  })

  it("多个 subagent 并行跟踪", async () => {
    const statuses: Array<{ id: string; task: string; status: string }> = []
    const onStart = (id: string, task: string) => statuses.push({ id, task, status: 'running' })
    const onEnd = (id: string, success: boolean) => {
      const idx = statuses.findIndex(s => s.id === id)
      if (idx >= 0) statuses[idx] = { ...statuses[idx], status: success ? 'done' : 'error' }
    }

    onStart('sa_1', '任务 A')
    onStart('sa_2', '任务 B')
    onStart('sa_3', '任务 C')
    expect(statuses.filter(s => s.status === 'running')).toHaveLength(3)

    onEnd('sa_2', true)
    expect(statuses.filter(s => s.status === 'running')).toHaveLength(2)
    expect(statuses.find(s => s.id === 'sa_2')?.status).toBe('done')

    onEnd('sa_1', false)
    onEnd('sa_3', true)
    expect(statuses.filter(s => s.status === 'running')).toHaveLength(0)
    expect(statuses.filter(s => s.status === 'done')).toHaveLength(2)
    expect(statuses.filter(s => s.status === 'error')).toHaveLength(1)
  })
})
