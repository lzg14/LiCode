import { createOpenAI } from "@ai-sdk/openai"
import { createAnthropic } from "@ai-sdk/anthropic"

export interface ModelConfig {
  provider: string
  model: string
  apiKey?: string
  baseUrl?: string
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
    return createOpenAI({ apiKey, baseURL: config.baseUrl ?? "https://api.minimax.chat/v1" }).chat(config.model)
  }
  return createOpenAI({ apiKey, baseURL: config.baseUrl }).chat(config.model)
}
