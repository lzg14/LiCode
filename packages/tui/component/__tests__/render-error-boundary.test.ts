import { describe, expect, test, spyOn, afterEach, beforeEach } from "bun:test"
import { renderErrorFallback } from "../render-error-boundary"
import { devLogger } from "../../../core/dev-logger"

describe("renderErrorFallback", () => {
  let logSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    // mockImplementation 阻止 spyOn 默认调原实现（避免测试输出噪音）
    logSpy = spyOn(devLogger, "logException").mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
  })

  test("调 devLogger.logException 把错误 + stack 打到 dev log", () => {
    const err = new Error("boom")
    renderErrorFallback(err, () => {})
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(logSpy.mock.calls[0][0]).toContain("Render error")
    expect(logSpy.mock.calls[0][1]).toBe(err)
  })

  test("非 Error 对象（如 string）也能 log", () => {
    renderErrorFallback("just a string", () => {})
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(logSpy.mock.calls[0][1]).toBe("just a string")
  })

  test("fallback 返回 null（让 ErrorBoundary 安静兜底，不替代 children）", () => {
    const result = renderErrorFallback(new Error("x"), () => {})
    expect(result).toBeNull()
  })

  test("reset 函数不强制调用（用户决定）", () => {
    let resetCalled = false
    renderErrorFallback(new Error("x"), () => { resetCalled = true })
    // reset 是 ErrorBoundary 提供的恢复函数；我们不强制调它
    expect(resetCalled).toBe(false)
  })
})