import type { LLMProvider, LLMRequest, LLMResponse, StreamChunk } from './types'

export class AnthropicProvider implements LLMProvider {
  name = 'anthropic'
  private apiKey: string
  private baseUrl: string

  constructor(apiKey: string, baseUrl = 'https://api.anthropic.com/v1') {
    this.apiKey = apiKey
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

  async *stream(request: LLMRequest): AsyncIterable<StreamChunk> {
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
        stream: true,
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

    const reader = response.body?.getReader()
    if (!reader) throw new Error('No response body')

    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim()
            if (data === '[DONE]') {
              yield { type: 'done' }
              return
            }
            try {
              const event = JSON.parse(data)
              if (event.type === 'content_block_delta') {
                if (event.delta.type === 'text_delta') {
                  yield { type: 'text', content: event.delta.text }
                } else if (event.delta.type === 'thinking_delta') {
                  yield { type: 'thinking', content: event.delta.thinking }
                }
              } else if (event.type === 'message_delta' && event.usage) {
                yield {
                  type: 'usage',
                  usage: {
                    inputTokens: event.usage.input_tokens,
                    outputTokens: event.usage.output_tokens,
                  },
                }
              }
            } catch {
              // skip malformed events
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }
}
