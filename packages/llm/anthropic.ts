import type { LLMProvider, LLMRequest, LLMResponse } from './types'

export class AnthropicProvider implements LLMProvider {
  name = 'anthropic'
  private apiKey: string
  private baseUrl: string

  constructor(apiKey: string, baseUrl = 'https://api.anthropic.com/v1') {
    this.apiKey = apiKey
    // 兼容处理：如果传入的是完整 URL，直接使用
    // 如果已经包含 /v1 或 /messages，不追加
    if (baseUrl.includes('/v1') || baseUrl.includes('/messages')) {
      this.baseUrl = baseUrl
    } else {
      this.baseUrl = `${baseUrl}/v1`
    }
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const response = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        max_tokens: request.maxTokens ?? 4096,
        temperature: request.temperature ?? 1,
      }),
    })

    if (!response.ok) {
      let error = ''
      try {
        error = await response.text()
      } catch {
        error = response.statusText
      }
      throw new Error(`Anthropic API error: ${response.status} ${error}`)
    }

    let data: { content?: { type: string; text?: string; thinking?: string }[]; usage?: { input_tokens: number; output_tokens: number } }
    try {
      data = await response.json() as typeof data
    } catch {
      throw new Error('Anthropic API error: 无法解析响应 JSON')
    }

    const contentBlocks = data.content ?? []
    const textBlock = contentBlocks.find(b => b.type === 'text')

    return {
      content: textBlock?.text ?? '',
      usage: data.usage ? {
        inputTokens: data.usage.input_tokens,
        outputTokens: data.usage.output_tokens,
      } : undefined,
    }
  }
}
