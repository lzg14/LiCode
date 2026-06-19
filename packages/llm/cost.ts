import { MODEL_CATALOG } from './catalog'
import type { LLMResponse } from './types'

export interface CostEstimate {
  model: string
  inputTokens: number
  outputTokens: number
  inputCost: number
  outputCost: number
  totalCost: number
}

export function estimateCost(model: string, inputTokens: number, outputTokens: number): CostEstimate {
  const config = MODEL_CATALOG[model]
  const inputCost = (inputTokens / 1000) * (config?.costPer1kInput ?? 0)
  const outputCost = (outputTokens / 1000) * (config?.costPer1kOutput ?? 0)

  return {
    model,
    inputTokens,
    outputTokens,
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
  }
}

export function calculateCost(model: string, response: LLMResponse): CostEstimate | null {
  if (!response.usage) return null
  return estimateCost(model, response.usage.inputTokens, response.usage.outputTokens)
}

export function formatCost(cents: number): string {
  if (cents < 0.01) return `$${cents.toFixed(4)}`
  if (cents < 1) return `$${cents.toFixed(3)}`
  return `$${cents.toFixed(2)}`
}
