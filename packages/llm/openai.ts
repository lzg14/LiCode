import type { LLMProvider, LLMRequest, LLMResponse, StreamChunk } from './types'

export class OpenAIProvider implements LLMProvider {
  name = 'openai'
  private apiKey: string
  private baseUrl = 'https://api.openai.com/v1'

  constructor(apiKey: string, baseUrl?: string) {
    this.apiKey = apiKey
    if (baseUrl) this.baseUrl = baseUrl
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        temperature: request.temperature ?? 1,
        max_tokens: request.maxTokens ?? 4096,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`OpenAI API error: ${response.status} ${error}`)
    }

    const data = await response.json() as { choices: { message: { content: string } }[]; usage: { prompt_tokens: number; completion_tokens: number } }
    return {
      content: data.choices[0]?.message?.content ?? '',
      usage: {
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens,
      },
    }
  }

  async *stream(request: LLMRequest): AsyncIterable<StreamChunk> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        temperature: request.temperature ?? 1,
        max_tokens: request.maxTokens ?? 4096,
        stream: true,
        stream_options: { include_usage: true },
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`OpenAI API error: ${response.status} ${error}`)
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
              const delta = event.choices?.[0]?.delta
              if (delta?.content) {
                yield { type: 'text', content: delta.content }
              }
              if (event.usage) {
                yield {
                  type: 'usage',
                  usage: {
                    inputTokens: event.usage.prompt_tokens,
                    outputTokens: event.usage.completion_tokens,
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
