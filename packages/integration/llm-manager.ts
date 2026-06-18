import type { LLMProvider, LLMRequest, LLMResponse } from '../llm/types'
import { AnthropicProvider } from '../llm/anthropic'
import { OpenAIProvider } from '../llm/openai'

/**
 * LLM Provider 管理器 - 管理多个 LLM 提供商
 */

export interface ProviderConfig {
  name: string
  provider: 'anthropic' | 'openai' | 'local'
  apiKey?: string
  apiKeyEnv?: string
  baseUrl?: string
  model: string
  priority: number
}

export class LLMManager {
  private providers = new Map<string, { config: ProviderConfig; instance: LLMProvider }>()
  private defaultProvider?: string

  /**
   * 注册 Provider
   */
  register(config: ProviderConfig): void {
    let instance: LLMProvider

    const apiKey = config.apiKey || (config.apiKeyEnv ? process.env[config.apiKeyEnv] : '') || ''

    if (config.provider === 'anthropic') {
      instance = new AnthropicProvider(apiKey, config.baseUrl)
    } else if (config.provider === 'openai') {
      instance = new OpenAIProvider(apiKey, config.baseUrl)
    } else {
      throw new Error(`Unsupported provider: ${config.provider}`)
    }

    this.providers.set(config.name, { config, instance })

    if (!this.defaultProvider || config.priority > (this.providers.get(this.defaultProvider)?.config.priority || 0)) {
      this.defaultProvider = config.name
    }
  }

  /**
   * 获取 Provider
   */
  get(name?: string): LLMProvider | undefined {
    const key = name || this.defaultProvider
    return this.providers.get(key)?.instance
  }

  /**
   * 获取默认 Provider
   */
  getDefault(): LLMProvider | undefined {
    return this.get()
  }

  /**
   * 列出所有 Provider
   */
  list(): ProviderConfig[] {
    return Array.from(this.providers.values()).map(p => p.config)
  }

  /**
   * 调用 LLM
   */
  async complete(request: LLMRequest, providerName?: string): Promise<LLMResponse> {
    const provider = this.get(providerName)
    if (!provider) {
      throw new Error('No LLM provider available')
    }
    return provider.complete(request)
  }
}

export const llmManager = new LLMManager()
