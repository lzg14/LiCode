import { render, useKeyboard, useRenderer } from "@opentui/solid"
import { createCliRenderer, type CliRendererConfig } from "@opentui/core"
import { Switch, Match, ErrorBoundary, onMount, onCleanup } from "solid-js"
import { CoreLoop } from "../core/loop"
import { configLoader } from "../config/loader"
import { createModel } from "../llm/provider"
import { registerBuiltinTools } from "../tools/builtin"
import { devLogger, setupGlobalErrorHandlers } from "../core/dev-logger"
import { doCopy } from "./util/selection"
import { focusInput } from "./component/prompt"

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
    // 首次渲染完成后触发 SIGWINCH，强制 @opentui 重新读取终端尺寸
    // 解决终端 resize 后首次启动布局错乱的问题
    setTimeout(() => process.emit("SIGWINCH" as any), 100)

    const onResize = () => process.emit("SIGWINCH" as any)
    process.stdout.on("resize", onResize)
    onCleanup(() => process.stdout.off("resize", onResize))
  })

  useKeyboard((evt) => {
    if (evt.ctrl && evt.name === "l") {
      evt.preventDefault()
      loop.clearMessages()
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

  const model = createModel(config.llm)
  const loop = new CoreLoop(config, undefined)

  // 自动加载最近的 session，实现跨启动连续性
  const lastSessionId = loop.getLastSessionId(process.cwd())

  const rendererConfig: CliRendererConfig = {
    externalOutputMode: "passthrough",
    targetFps: 60,
    exitOnCtrlC: false,
    useKittyKeyboard: {},
    enableMouseMovement: false,
    useMouse: true,
    autoFocus: true,
  }

  const renderer = await createCliRenderer(rendererConfig)

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
                        <LoopProvider loop={loop} model={model} provider={config.llm.provider} sessionId={lastSessionId ?? undefined}>
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
