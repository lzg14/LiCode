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
  const apiKey = config.apiKey || process.env[`${provider.toUpperCase()}_API_KEY`] || ""

  if (provider === "deepseek") {
    return createOpenAI({ apiKey, baseURL: config.baseUrl ?? "https://api.deepseek.com" }).chat(config.model)
  }
  if (provider === "anthropic") {
    return createAnthropic({ apiKey, baseURL: config.baseUrl })(config.model)
  }
  return createOpenAI({ apiKey, baseURL: config.baseUrl }).chat(config.model)
}
