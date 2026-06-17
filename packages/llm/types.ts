export interface LLMRequest {
  model: string
  messages: { role: string; content: string }[]
  temperature?: number
  maxTokens?: number
}

export interface LLMResponse {
  content: string
  usage?: {
    inputTokens: number
    outputTokens: number
  }
}

export interface LLMProvider {
  name: string
  complete(request: LLMRequest): Promise<LLMResponse>
}
