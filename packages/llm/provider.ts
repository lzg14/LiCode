import { createOpenAI } from "@ai-sdk/openai"
import { createAnthropic } from "@ai-sdk/anthropic"
import { PROVIDER_PRIORITY, getModelConfig } from "./catalog"
import { classifyError, getRetryStrategy, formatRetryMessage, waitAndRetry } from "./retry-strategy"

export interface ModelConfig {
  provider: string
  model: string
  apiKey?: string
  baseUrl?: string
}

/**
 * 模型名规范化（用于 catalog 查表）：
 * - MiniMax-M3[1M] -> MiniMax-M3（去掉后缀）
 * - 用户随便加的 [xxx] 后缀都剥掉
 *
 * **重要**：这个函数只用于 catalog 查表的 fallback 分支。
 * 给 AI SDK 调用的 model id **不能用这个规范化**（API 端需要原始 model 名），
 * 否则会丢失 [1M] 等 context 标识。
 */
export function normalizeModelIdForCatalog(model: string): string {
  // 只剥最右一个 [xxx]（不允许内嵌方括号），避免 foo[bar][baz] 把整段吃掉
  return model.replace(/\[[^\[\]]*\]$/, "").trim()
}

/**
 * 解析模型的 context window。
 * 用原始 model 字符串（含 [1M] 后缀）查 catalog —— 保证命中正确的版本。
 * 未注册模型返回 undefined，调用方应走 fallback（unknownModelThreshold）。
 */
export function resolveContextWindow(rawModel: string): number | undefined {
  // 直接查原始字符串 —— catalog 里 MiniMax-M3[1M] 是独立条目，contextWindow=1M
  const direct = getModelConfig(rawModel)
  if (direct) return direct.contextWindow
  // 未注册：尝试 normalize 后的名字（兼容少数情况，比如把 MiniMax-M3[1M] 误剥后还想命中 MiniMax-M3）
  const normalized = normalizeModelIdForCatalog(rawModel)
  if (normalized !== rawModel) {
    const fallback = getModelConfig(normalized)
    if (fallback) return fallback.contextWindow
  }
  return undefined
}

/**
 * MiniMax 模型名规范化（给 AI SDK 调用用）：
 * - MiniMax-M3[1M] -> MiniMax-M3 （[1M] 是 context 标识，不是 API 端认识的 model name）
 * - 用户随便加的 [xxx] 后缀都剥掉
 */
function normalizeMiniMaxModel(model: string): string {
  return model.replace(/\[[^\[\]]*\]$/, "").trim()
}

function createModelForProvider(provider: string, config: ModelConfig) {
  let apiKey = config.apiKey || process.env[`${provider.toUpperCase()}_API_KEY`] || ""
  // fallback: 如果没找到 provider 专属 key，尝试 ANTHROPIC_AUTH_TOKEN
  if (!apiKey) apiKey = process.env.ANTHROPIC_AUTH_TOKEN || ""

  if (provider === "deepseek") {
    return createOpenAI({ apiKey, baseURL: config.baseUrl ?? "https://api.deepseek.com" }).chat(config.model)
  }
  if (provider === "anthropic") {
    return createAnthropic({ apiKey, baseURL: config.baseUrl })(config.model)
  }
  if (provider === "minimax") {
    const model = normalizeMiniMaxModel(config.model)
    const baseURL = config.baseUrl ?? "https://api.minimaxi.com/anthropic"
    if (baseURL.includes("/v1")) {
      return createOpenAI({ apiKey, baseURL }).chat(model)
    }
    return createAnthropic({ apiKey, baseURL })(model)
  }
  return createOpenAI({ apiKey, baseURL: config.baseUrl }).chat(config.model)
}

/**
 * createModel 返回值：包含 AI SDK model 实例 + 该模型在 catalog 中的 contextWindow。
 * contextWindow 必须用**原始 config.model** 查表（不能用 normalize 后名字），
 * 否则 MiniMax-M3[1M] 会被剥成 MiniMax-M3 命中 128K 而不是 1M。
 */
export interface CreateModelResult {
  model: any
  contextWindow: number | undefined
}

export async function createModel(config: ModelConfig): Promise<CreateModelResult> {
  const primaryProvider = config.provider.toLowerCase()
  const providers = [primaryProvider, ...PROVIDER_PRIORITY.filter(p => p !== primaryProvider)]

  for (const provider of providers) {
    const maxRetries = 3
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const model = createModelForProvider(provider, { ...config, provider })
        return { model, contextWindow: resolveContextWindow(config.model) }
      } catch (error) {
        const category = classifyError(error)
        const strategy = getRetryStrategy(category)
        const message = formatRetryMessage(category, error, attempt)

        if (!strategy.shouldRetry(attempt)) {
          process.stderr.write(`[provider] ${provider} 失败: ${message}\n`)
          break
        }

        process.stderr.write(`[provider] ${provider} 第 ${attempt + 1} 次重试: ${message}\n`)
        await waitAndRetry(category, attempt, error)
      }
    }
  }

  throw new Error(`All providers failed for model ${config.model}`)
}