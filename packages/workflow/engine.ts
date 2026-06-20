import { runInSandbox, genId } from "./sandbox"
import type { WorkflowContext, WorkflowResult, WorkflowMeta, PhaseRecord } from "./types"

/**
 * Workflow Engine
 * 加载并执行 workflow 脚本
 */

export interface EngineConfig {
  maxConcurrentAgents: number
  maxDepth: number
  timeoutMs: number
  cwd: string
  llmProvider?: { complete: (req: any) => Promise<any>; modelId?: string }
  toolExecutor: <T = any>(name: string, input: any) => Promise<{ success: boolean; output?: T; error?: string }>
  scriptRegistry: ScriptRegistry
}

export interface ScriptRegistry {
  get(name: string): string | null
  set(name: string, script: string): void
  list(): string[]
}

const BUILTIN_SCRIPTS: Record<string, string> = {}

export class WorkflowEngine {
  private config: EngineConfig
  private phaseRecords: PhaseRecord[] = []
  private currentPhase: PhaseRecord | null = null
  private agentSemaphore: number

  constructor(config: EngineConfig) {
    this.config = config
    this.agentSemaphore = config.maxConcurrentAgents
  }

  /**
   * 运行一个 workflow
   * @param input scriptName | inlineScript
   * @param args 传给 workflow 的参数
   */
  async run(input: { name: string; script?: string; args: any }): Promise<WorkflowResult> {
    const startTime = Date.now()
    this.phaseRecords = []

    // 1. 解析脚本
    const script = input.script ?? this.config.scriptRegistry.get(input.name)
    if (!script) {
      return {
        success: false,
        error: `Workflow 脚本未找到: ${input.name}`,
        phases: [],
        duration: 0,
        tokenUsage: { input: 0, output: 0 },
      }
    }

    const runId = genId()

    // 2. 构造 workflow context（原语）
    const wfContext = this.buildContext(input.args)

    // 3. 在沙箱中执行
    let exportResult: any
    let error: string | undefined
    try {
      const { exports } = await runInSandbox(script, {
        context: wfContext as any,
        timeoutMs: this.config.timeoutMs,
      })
      exportResult = exports
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }

    // 4. 关闭当前未结束的阶段
    if (this.currentPhase && !this.currentPhase.endTime) {
      this.currentPhase.endTime = Date.now()
      this.currentPhase.success = !error
      this.currentPhase.error = error
    }

    return {
      success: !error,
      output: exportResult,
      error,
      phases: this.phaseRecords,
      duration: Date.now() - startTime,
      tokenUsage: { input: 0, output: 0 }, // TODO: 收集 token
    }
  }

  /**
   * 构造 workflow 上下文（原语）
   */
  private buildContext(args: any): WorkflowContext {
    const engine = this
    return {
      args,
      cwd: this.config.cwd,

      agent: async (prompt, opts) => {
        if (engine.agentSemaphore <= 0) {
          throw new Error("Agent 并发上限已达")
        }
        engine.agentSemaphore--
        try {
          if (!engine.config.llmProvider) {
            throw new Error("未配置 LLM provider")
          }
          const response = await engine.config.llmProvider.complete({
            model: opts?.model ?? engine.config.llmProvider.modelId,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7,
          })
          return response.content ?? ""
        } finally {
          engine.agentSemaphore++
        }
      },

      tool: async (name, input) => {
        return engine.config.toolExecutor(name, input)
      },

      phase: (title, detail) => {
        // 关闭上一个 phase
        if (engine.currentPhase) {
          engine.currentPhase.endTime = Date.now()
        }
        // 开启新 phase
        const record: PhaseRecord = {
          title,
          detail,
          startTime: Date.now(),
        }
        engine.currentPhase = record
        engine.phaseRecords.push(record)
      },

      log: (msg) => {
        const record: PhaseRecord = {
          title: "log",
          detail: msg,
          startTime: Date.now(),
          endTime: Date.now(),
        }
        engine.phaseRecords.push(record)
      },

      parallel: async (thunks) => {
        return Promise.all(thunks.map((t) => t()))
      },

      pipeline: async (items, ...stages) => {
        let result: any = items
        for (const stage of stages) {
          result = await stage(result)
        }
        return result
      },

      workflow: async (nameOrScript, subArgs) => {
        if (nameOrScript.startsWith("export const meta")) {
          return engine.run({ name: "inline", script: nameOrScript, args: subArgs })
        }
        return engine.run({ name: nameOrScript, args: subArgs })
      },

      readFile: async (path) => {
        try {
          const fs = await import("fs/promises")
          return await fs.readFile(path, "utf-8")
        } catch {
          return null
        }
      },

      writeFile: async (path, content) => {
        const fs = await import("fs/promises")
        await fs.writeFile(path, content, "utf-8")
      },

      exists: async (path) => {
        try {
          const fs = await import("fs")
          return fs.existsSync(path)
        } catch {
          return false
        }
      },

      glob: async (pattern) => {
        try {
          const { glob } = await import("glob")
          const files = await glob(pattern, {
            cwd: engine.config.cwd,
            ignore: ["node_modules", ".git", "dist"],
          })
          return files
        } catch {
          return []
        }
      },
    }
  }
}
