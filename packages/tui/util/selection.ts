import { copyToClipboard } from "./clipboard"

type Toast = {
  show: (input: { message: string; variant: "info" | "success" | "warning" | "error" }) => void
  error: (err: unknown) => void
}

type Renderer = {
  getSelection: () => { getSelectedText: () => string } | null
  clearSelection: () => void
}

export function doCopy(renderer: Renderer, toast: Toast, message: string): boolean {
  const text = renderer.getSelection()?.getSelectedText()
  if (!text) return false

  copyToClipboard(text)
    .then(() => toast.show({ message, variant: "info" }))
    .catch(toast.error)

  renderer.clearSelection()
  return true
}
