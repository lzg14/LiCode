import { Switch, Match, ErrorBoundary, onMount } from "solid-js"
import { render, useKeyboard, useRenderer } from "@opentui/solid"
import { createCliRenderer, type CliRendererConfig } from "@opentui/core"
import { CoreLoop } from "../core/loop"
import { configLoader } from "../config/loader"
import { createModel } from "../llm/provider"
import { registerBuiltinTools } from "../tools/builtin"
import { createSecurityLayer, setSecurityLayer } from "../security"
import { devLogger, setupGlobalErrorHandlers } from "../core/dev-logger"
import { doCopy } from "./util/selection"
import { focusInput } from "./component/prompt"
import { generateText } from "ai"
import type { LLMProvider } from "../llm/types"

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

import { ThemeProvider } from "./context/theme"
import { RouteProvider, useRoute } from "./context/route"
import { ConfigProvider } from "./context/config"
import { LoopProvider, useLoop } from "./context/loop"
import { KeybindProvider } from "./context/keybind"
import { HistoryProvider } from "./context/history"
import { DialogProvider } from "./ui/dialog"
import { ToastProvider, useToast, Toast } from "./ui/toast"
import { Home } from "./routes/home"

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
  const loop = useLoop()
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

  const model = await createModel(config.llm)
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

  const rendererConfig: CliRendererConfig = {
    externalOutputMode: "passthrough",
    targetFps: 60,
    exitOnCtrlC: false,
    useKittyKeyboard: {},
    enableMouseMovement: true,
    useMouse: true,
    autoFocus: true,
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
                        <LoopProvider loop={loop} model={model} provider={config.llm.provider} sessionId={lastSessionId ?? undefined} llmConfig={config.llm}>
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
