import { type CliRendererConfig, createCliRenderer } from "@opentui/core"
import { render, useKeyboard, useRenderer } from "@opentui/solid"
import { generateText } from "ai"
import { ErrorBoundary, Match, onMount, Switch } from "solid-js"
import { configLoader } from "../config/loader"
import { devLogger, setupGlobalErrorHandlers } from "../core/dev-logger"
import { CoreLoop } from "../core/loop"
import { createModel } from "../llm/provider"
import type { LLMProvider } from "../llm/types"
import { createSecurityLayer, setSecurityLayer } from "../security"
import { registerBuiltinTools } from "../tools/builtin"
import { focusInput } from "./component/prompt"
import { doCopy } from "./util/selection"

/** 保存终端尺寸，用于 Ctrl+L 刷新 */
let savedWidth = 80
let savedHeight = 24

/** 获取终端尺寸，优先从 stdout 获取，fallback 到 stdin */
function getTerminalSize(): { width: number; height: number } {
  const tty = process.stdout as any
  const stdinTty = process.stdin as any
  const stdoutCols: number = tty?.columns
  const stdoutRows: number = tty?.rows
  const stdinCols: number = stdinTty?.columns
  const stdinRows: number = stdinTty?.rows

  // 优先使用 stdout 的尺寸
  if (stdoutCols && stdoutRows) {
    return { width: stdoutCols, height: stdoutRows }
  }
  // fallback 到 stdin（某些环境下 stdin 是 TTY）
  if (stdinCols && stdinRows) {
    return { width: stdinCols, height: stdinRows }
  }
  // 最后 fallback 到默认值
  return { width: 80, height: 24 }
}

import { ConfigProvider } from "./context/config"
import { HistoryProvider } from "./context/history"
import { KeybindProvider } from "./context/keybind"
import { LoopProvider, useLoop } from "./context/loop"
import { RouteProvider, useRoute } from "./context/route"
import { ThemeProvider } from "./context/theme"
import { Home } from "./routes/home"
import { DialogProvider } from "./ui/dialog"
import { Toast, ToastProvider, useToast } from "./ui/toast"

setupGlobalErrorHandlers(devLogger)

async function loadConfig() {
  try {
    const homeDir = process.env.HOME || process.env.USERPROFILE || ""
    return await configLoader.discoverAndLoad(homeDir)
  } catch {
    return {
      llm: { provider: "anthropic" as const, model: "claude-sonnet-4-20250514", apiKeyEnv: "ANTHROPIC_API_KEY" },
      security: { commandWhitelist: [], allowedPaths: [], deniedPaths: [] },
      memory: { path: "./licode-memory.db", retentionDays: 30 },
      subagent: { maxConcurrent: 3, maxDepth: 1, timeoutMs: 900000, blockedTools: [] },
    }
  }
}

function App() {
  const route = useRoute()
  const _loop = useLoop()
  const renderer = useRenderer()
  const toast = useToast()

  onMount(() => {
    const { width: w, height: h } = getTerminalSize()
    savedWidth = w
    savedHeight = h

    // 检测 TTY 状态
    const isTTY = process.stdout.isTTY || process.stdin?.isTTY
    if (!isTTY) {
      devLogger.warn('APP', 'Terminal TTY not detected. Scroll may not work. Try running in a real terminal (not IDE/remote shell).')
    }

    renderer.emit?.("resize", w, h)
  })

  useKeyboard((evt) => {
    if (evt.ctrl && evt.name === "l") {
      // Ctrl+L: 刷新界面（发射当前尺寸的 resize 事件触发重绘）
      savedWidth = getTerminalSize().width
      savedHeight = getTerminalSize().height
      renderer.emit?.("resize", savedWidth, savedHeight)
      return
    }
    if (evt.ctrl && evt.name === "d") {
      evt.preventDefault()
      process.exit(0)
      return
    }
    if (evt.ctrl && evt.name === "c") {
      if (!doCopy(renderer, toast, "已复制到剪贴板")) {
        renderer.clearSelection()
        return
      }
      evt.preventDefault()
      evt.stopPropagation()
      setTimeout(() => focusInput(), 10)
      return
    }
  })

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: @opentui/core <box> 是 TUI 元素，不是 HTML 元素
    <box
      flexDirection="column"
      height="100%"
      onMouseUp={() => {
        doCopy(renderer, toast, "已复制到剪贴板")
        setTimeout(() => focusInput(), 10)
      }}
    >
      <Switch>
        <Match when={route.data().type === "home"}>
          <Home />
        </Match>
      </Switch>
    </box>
  )
}

export async function tui(config: any) {
  devLogger.info('APP', `Starting licode TUI | log=${devLogger.getLogFile()}`)
  devLogger.logSession('TUI started', config)

  // 创建 SecurityLayer，**追加**用户配置到默认上
  // 默认白名单：PLATFORM_DEFAULTS.commandWhitelist（平台默认）
  // 用户白名单：config.security?.commandWhitelist（追加）
  // 这样新用户开箱即用，不需要理解"覆盖 vs 追加"
  const { mergeSecurityConfig, PLATFORM_DEFAULTS } = await import("../security/merge")
  const securityConfig = mergeSecurityConfig(PLATFORM_DEFAULTS, config.security)
  const securityLayer = createSecurityLayer(securityConfig)
  setSecurityLayer(securityLayer)
  devLogger.info('APP', `SecurityLayer created: ${securityConfig.commandWhitelist.length} commands allowed`)

  const { model, contextWindow } = await createModel(config.llm)
  const llmProvider: LLMProvider = {
    name: 'compact',
    async complete(req) {
      const systemMsg = req.messages.find((m: any) => m.role === 'system')
      const chatMsgs = req.messages.filter((m: any) => m.role !== 'system')
      const result = await generateText({
        model,
        system: systemMsg ? (typeof systemMsg.content === 'string' ? systemMsg.content : '') : undefined,
        messages: chatMsgs as any,
        temperature: req.temperature ?? 0.3,
      })
      return { content: result.text }
    },
  }
  const loop = new CoreLoop(config, llmProvider)

  // 自动加载最近的 session，实现跨启动连续性
  const lastSessionId = loop.getLastSessionId(process.cwd())

  // 渲染器调优：targetFps / maxFps 双轨
  //
  // OpenTUI 两个 fps 参数各司其职（见 @opentui/core renderer.d.ts 注释）：
  // - targetFps：持续模式的目标 fps（无 dirty 也在跑），idle 耗 CPU 的主因
  // - maxFps：scroll/key/resize 触发 requestRender() 时的立即重绘上限
  //
  // 设 targetFps < maxFps，idle 走慢节奏、交互走快节奏 → 既省 CPU 又流畅
  //
  // - targetFps 30：比默认 60 省一半。30fps 肉眼无感（TUI 不需要 60fps 动画，
  //   光标闪烁由终端处理）。OpenTUI 默认值就是 30，之前 licode 设 60 是误用
  // - maxFps 60：scroll/key 触发 requestRender() 时立即重绘，受 16.67ms 上限
  //   约束，确保交互跟手
  // - enableMouseMovement false：关掉鼠标移动事件流，否则会触发高频
  //   SolidJS 重算 → 持续渲染 + 立即重绘两条路径同时抢主线程 → 滚动卡。
  //   点击/滚轮由 useMouse 单独处理，不受影响
  const rendererConfig: CliRendererConfig = {
    externalOutputMode: "passthrough",
    targetFps: 30,
    maxFps: 60,
    exitOnCtrlC: false,
    useKittyKeyboard: {},
    enableMouseMovement: false,
    useMouse: true,
    autoFocus: true,
    // FPS 数据收集。OTUI_SHOW_STATS=true 时同时显示 debug overlay，右下角实时
    // 显示 fps / avg frame time，用来验证 targetFps / maxFps 行为是否符合预期。
    // 默认关闭，避免无谓开销。
    gatherStats: process.env.OTUI_SHOW_STATS === "true",
  }

  const renderer = await createCliRenderer(rendererConfig)

  // 确保鼠标模式已启用（触摸板滚动需要）
  const r = renderer as any
  if (r.enableMouse) {
    r.enableMouse()
  }

  try {
    await render(() => {
      return (
        <ErrorBoundary fallback={(error) => {
          devLogger.error('RENDER', 'ErrorBoundary caught error', error)
          return <text fg="#f38ba8">{String(error)}</text>
        }}>
          <ConfigProvider config={config}>
            <ThemeProvider>
              <RouteProvider>
                <HistoryProvider>
                  <KeybindProvider>
                    <DialogProvider>
                      <ToastProvider>
                        <Toast />
                        <LoopProvider loop={loop} model={model} provider={config.llm.provider} sessionId={lastSessionId ?? undefined} llmConfig={config.llm} effectiveContextWindow={contextWindow}>
                          <App />
                        </LoopProvider>
                      </ToastProvider>
                    </DialogProvider>
                  </KeybindProvider>
                </HistoryProvider>
              </RouteProvider>
            </ThemeProvider>
          </ConfigProvider>
        </ErrorBoundary>
      )
    }, renderer)
  } catch (error) {
    devLogger.logException('RENDER.render', error)
    throw error
  }
}

export async function runTUI(): Promise<void> {
  try {
    registerBuiltinTools()
    devLogger.info('APP', 'Builtin tools registered')
    const config = await loadConfig()
    devLogger.info('APP', 'Config loaded', config)
    await tui(config)
  } catch (error) {
    devLogger.logException('runTUI', error)
    throw error
  }
}
