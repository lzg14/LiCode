export interface AuthConfig {
  apiKey?: string
  oauthToken?: string
  baseUrl?: string
}

export class AuthManager {
  private configs: Map<string, AuthConfig> = new Map()

  setProvider(provider: string, config: AuthConfig): void {
    this.configs.set(provider, config)
  }

  getProvider(provider: string): AuthConfig | undefined {
    return this.configs.get(provider)
  }

  getApiKey(provider: string): string | undefined {
    return this.configs.get(provider)?.apiKey
  }

  getOAuthToken(provider: string): string | undefined {
    return this.configs.get(provider)?.oauthToken
  }

  getBaseUrl(provider: string): string | undefined {
    return this.configs.get(provider)?.baseUrl
  }

  hasAuth(provider: string): boolean {
    const config = this.configs.get(provider)
    return !!(config?.apiKey || config?.oauthToken)
  }

  removeProvider(provider: string): void {
    this.configs.delete(provider)
  }

  listProviders(): string[] {
    return Array.from(this.configs.keys())
  }

  static fromEnv(): AuthManager {
    const manager = new AuthManager()

    const anthropicKey = process.env.ANTHROPIC_API_KEY
    if (anthropicKey) {
      manager.setProvider('anthropic', { apiKey: anthropicKey })
    }

    const openaiKey = process.env.OPENAI_API_KEY
    if (openaiKey) {
      manager.setProvider('openai', { apiKey: openaiKey })
    }

    const openaiBaseUrl = process.env.OPENAI_BASE_URL
    if (openaiBaseUrl && manager.hasAuth('openai')) {
      const config = manager.getProvider('openai')!
      config.baseUrl = openaiBaseUrl
      manager.setProvider('openai', config)
    }

    return manager
  }
}
