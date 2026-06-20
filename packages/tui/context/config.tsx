import { createContext, useContext, type JSX, type Accessor } from "solid-js"
import type { Config } from "../../core/types"

export interface ConfigContext {
  config: Accessor<Config>
}

const Ctx = createContext<ConfigContext>()

export function ConfigProvider(props: { children: JSX.Element; config: Config }) {
  const value: ConfigContext = { config: () => props.config }
  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>
}

export function useConfig(): ConfigContext {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useConfig: missing ConfigProvider")
  return ctx
}
