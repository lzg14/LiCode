import { createOpenAI } from "@ai-sdk/openai"
import { createAnthropic } from "@ai-sdk/anthropic"

export interface ModelConfig {
  provider: string
  model: string
  apiKey?: string
  baseUrl?: string
}

/**
 * MiniMax 模型名规范化：
 * - MiniMax-M3[1M] -> MiniMax-M3 （[1M] 是 context 标识，不是模型名）
 * - 用户随便加的 [xxx] 后缀都剥掉
 */
function normalizeMiniMaxModel(model: string): string {
  return model.replace(/\[.*?\]$/, "").trim()
}

export function createModel(config: ModelConfig) {
  const provider = config.provider.toLowerCase()
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
