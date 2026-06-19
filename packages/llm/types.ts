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

export interface StreamChunk {
  type: 'text' | 'thinking' | 'usage' | 'done'
  content?: string
  usage?: {
    inputTokens: number
    outputTokens: number
  }
}

export interface LLMProvider {
  name: string
  complete(request: LLMRequest): Promise<LLMResponse>
  stream?(request: LLMRequest): AsyncIterable<StreamChunk>
}
