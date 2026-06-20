import { createContext, useContext, type ParentProps, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { SplitBorder } from "../component/border"
import { useTheme } from "../context/theme"

export interface ToastOptions {
  message: string
  variant?: "info" | "success" | "warning" | "error"
  title?: string
  duration?: number
}

export interface ToastContext {
  currentToast: ToastOptions | null
  show: (options: ToastOptions) => void
  error: (err: unknown) => void
}

const ctx = createContext<ToastContext>()

function init() {
  const [store, setStore] = createStore({
    currentToast: null as ToastOptions | null,
  })

  let timeoutHandle: ReturnType<typeof setTimeout> | null = null

  const toast: ToastContext = {
    get currentToast() { return store.currentToast },
    show(options: ToastOptions) {
      const { duration = 5000, ...currentToast } = options
      setStore("currentToast", currentToast)
      if (timeoutHandle) clearTimeout(timeoutHandle)
      timeoutHandle = setTimeout(() => setStore("currentToast", null), duration)
    },
    error: (err: unknown) => {
      if (err instanceof Error) return toast.show({ message: err.message, variant: "error" })
      toast.show({ message: String(err), variant: "error" })
    },
  }
  return toast
}

export function ToastProvider(props: ParentProps) {
  const value = init()
  return <ctx.Provider value={value}>{props.children}</ctx.Provider>
}

export function useToast() {
  const value = useContext(ctx)
  if (!value) throw new Error("useToast: missing ToastProvider")
  return value
}

export function Toast() {
  const toast = useToast()
  const theme = useTheme()

  return (
    <Show when={toast.currentToast}>
      {(current) => {
        const variant = current().variant ?? "info"
        const borderColor = variant === "success" ? theme.success()
          : variant === "warning" ? theme.warning()
          : variant === "error" ? theme.error()
          : theme.info()
        return (
          <box
            position="absolute"
            zIndex={4000}
            justifyContent="center"
            alignItems="flex-start"
            top={2}
            right={2}
            maxWidth={54}
            paddingLeft={2}
            paddingRight={2}
            paddingTop={1}
            paddingBottom={1}
            backgroundColor={theme.backgroundPanel()}
            borderColor={borderColor}
            border={SplitBorder.border}
            customBorderChars={SplitBorder.customBorderChars}
          >
            <Show when={current().title}>
              <text marginBottom={1} fg={theme.text()}>
                {current().title}
              </text>
            </Show>
            <text fg={theme.text()} wrapMode="word" width="100%">
              {current().message}
            </text>
          </box>
        )
      }}
    </Show>
  )
}
