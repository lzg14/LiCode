import { state } from '../state'

export function renderStatusBar(): void {
  const theme = state.theme
  const phaseColors: Record<string, string> = {
    OBSERVE: theme.accent,
    THINK: theme.warning,
    PLAN: theme.accent,
    BUILD: theme.success,
    EXECUTE: theme.success,
    VERIFY: theme.warning,
    LEARN: theme.dim,
  }

  const phaseColor = phaseColors[state.phase] ?? theme.dim
  const spinner = state.isProcessing ? '⏳' : '✓'

  console.log()
  console.log(`\x1b[${phaseColor}m[${state.phase}]\x1b[0m ${spinner}`)
  console.log()
}
