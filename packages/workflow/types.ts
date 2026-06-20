export interface WorkflowMeta {
  name: string
  description: string
  whenToUse?: string
  phases?: { title: string; detail?: string }[]
}

export interface PhaseRecord {
  title: string
  detail?: string
  startTime: number
  endTime?: number
  success?: boolean
  error?: string
}

export interface WorkflowContext {
  args: any
  cwd?: string
  /** 调一个 agent（子 LLM 调用） */
  agent: (prompt: string, opts?: { model?: string; tools?: string[] }) => Promise<string>
  /** 调一个工具 */
  tool: <T = any>(name: string, input: any) => Promise<{ success: boolean; output?: T; error?: string }>
  /** 标记当前阶段 */
  phase: (title: string, detail?: string) => void
  /** 写日志 */
  log: (msg: string) => void
  /** 并发执行多个任务 */
  parallel: <T = any>(thunks: (() => Promise<T>)[]) => Promise<T[]>
  /** 流水线处理 items */
  pipeline: <T = any, R = any>(items: T[], ...stages: ((items: T[]) => Promise<R>[])[]) => Promise<R[]>
  /** 调子 workflow */
  workflow: (nameOrScript: string, args?: any) => Promise<any>
  /** 读文件 */
  readFile: (path: string) => Promise<string | null>
  /** 写文件 */
  writeFile: (path: string, content: string) => Promise<void>
  /** 检查文件是否存在 */
  exists: (path: string) => Promise<boolean>
  /** glob 匹配 */
  glob: (pattern: string) => Promise<string[]>
}

export interface WorkflowResult {
  success: boolean
  output?: any
  error?: string
  phases: PhaseRecord[]
  duration: number
  tokenUsage: { input: number; output: number }
}
