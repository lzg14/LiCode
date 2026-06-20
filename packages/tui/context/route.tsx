import { createContext, useContext, createSignal, type JSX, type Accessor } from "solid-js"

export type Route =
  | { type: "home" }
  | { type: "session"; sessionID: string }

export interface RouteContext {
  data: Accessor<Route>
  navigate: (route: Route) => void
}

const Ctx = createContext<RouteContext>()

export function RouteProvider(props: { children: JSX.Element; initialRoute?: Route }) {
  const [data, navigate] = createSignal<Route>(props.initialRoute ?? { type: "home" })

  const value: RouteContext = { data, navigate }
  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>
}

export function useRoute(): RouteContext {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useRoute: missing RouteProvider")
  return ctx
}
