export interface LLMTool {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export interface LLMToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

export interface LLMRequest {
  model: string
  messages: { role: string; content: string | Array<{ type: string; [key: string]: unknown }> }[]
  tools?: LLMTool[]
  temperature?: number
  maxTokens?: number
}

export interface LLMResponse {
  content: string
  toolCalls?: LLMToolCall[]
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
