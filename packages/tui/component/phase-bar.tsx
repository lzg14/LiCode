import { For, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { Spinner } from "./spinner"
import type { Phase } from "../../core/types"

const ALL_PHASES: Phase[] = ["OBSERVE", "THINK", "PLAN", "BUILD", "EXECUTE", "VERIFY", "LEARN"]

const PHASE_COLORS: Record<string, string> = {
  OBSERVE: "#6c7a89",
  THINK: "#f39c12",
  PLAN: "#3498db",
  BUILD: "#2ecc71",
  EXECUTE: "#2ecc71",
  VERIFY: "#e74c3c",
  LEARN: "#9b59b6",
}

const PHASE_LABELS: Record<string, string> = {
  OBSERVE: "观察",
  THINK: "思考",
  PLAN: "规划",
  BUILD: "构建",
  EXECUTE: "执行",
  VERIFY: "验证",
  LEARN: "学习",
}

export function PhaseBar(props: { phase: Phase }) {
  const { textMuted } = useTheme()
  const currentIdx = ALL_PHASES.indexOf(props.phase)

  return (
    <box width="100%" paddingX={1} paddingTop={1} paddingBottom={1}>
      <For each={ALL_PHASES.slice(0, currentIdx + 1)}>
        {(phase, i) => {
          const isActive = i() === currentIdx
          const isPast = i() < currentIdx
          const color = isPast ? "#2ecc71" : PHASE_COLORS[phase]

          return (
            <>
              {isActive ? (
                <box flexDirection="row" gap={1}>
                  <Spinner color={color} />
                  <text fg={color}>{PHASE_LABELS[phase] ?? phase}</text>
                </box>
              ) : (
                <text fg={color}>{` ● ${PHASE_LABELS[phase] ?? phase}`}</text>
              )}
              {i() < currentIdx && <text fg={textMuted()}>{` ─ `}</text>}
            </>
          )
        }}
      </For>
    </box>
  )
}
