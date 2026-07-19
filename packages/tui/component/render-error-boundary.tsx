import { ErrorBoundary, type JSX } from "solid-js"
import { devLogger } from "../../core/dev-logger"

/**
 * SolidJS ErrorBoundary 的 fallback 函数。
 *
 * 关键设计：fallback 必须把完整 error（含 stack）打到 devLogger，否则
 * 渲染错误只显示到 TUI 一行红条（用户看不懂），没有 stack 难以定位。
 *
 * 返回 null 让 ErrorBoundary 安静兜底（不显示任何 fallback UI）——
 * 错误已经在 dev log 里，TUI 上重复显示反而干扰用户。
 *
 * reset 参数保留（SolidJS ErrorBoundary signature 要求），但不在 fallback 内
 * 自动调用 —— 让 ErrorBoundary 自己管理恢复流程，避免无限重渲染。
 */
export function renderErrorFallback(err: unknown, _reset: () => void): JSX.Element {
  devLogger.logException("Render error in SolidJS component tree", err)
  return null
}

/**
 * SolidJS ErrorBoundary 包装组件：在 children 渲染 throw 时，
 * 调 renderErrorFallback 把错误打到 dev log。
 *
 * 用法：
 *   <RenderErrorBoundary>
 *     <App />
 *   </RenderErrorBoundary>
 */
export function RenderErrorBoundary(props: { children: JSX.Element }): JSX.Element {
  return (
    <ErrorBoundary fallback={renderErrorFallback}>
      {props.children}
    </ErrorBoundary>
  )
}