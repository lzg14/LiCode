export interface ModelConfig {
  id: string
  provider: string
  displayName: string
  contextWindow: number
  maxOutput: number
  supportsVision: boolean
  supportsToolUse: boolean
  supportsStreaming: boolean
  costPer1kInput: number
  costPer1kOutput: number
}

export const MODEL_CATALOG: Record<string, ModelConfig> = {
  'claude-sonnet-4-20250514': {
    id: 'claude-sonnet-4-20250514',
    provider: 'anthropic',
    displayName: 'Claude Sonnet 4',
    contextWindow: 200000,
    maxOutput: 64000,
    supportsVision: true,
    supportsToolUse: true,
    supportsStreaming: true,
    costPer1kInput: 0.003,
    costPer1kOutput: 0.015,
  },
  'claude-haiku-35-20241022': {
    id: 'claude-haiku-35-20241022',
    provider: 'anthropic',
    displayName: 'Claude 3.5 Haiku',
    contextWindow: 200000,
    maxOutput: 8192,
    supportsVision: true,
    supportsToolUse: true,
    supportsStreaming: true,
    costPer1kInput: 0.001,
    costPer1kOutput: 0.005,
  },
  'gpt-4o': {
    id: 'gpt-4o',
    provider: 'openai',
    displayName: 'GPT-4o',
    contextWindow: 128000,
    maxOutput: 16384,
    supportsVision: true,
    supportsToolUse: true,
    supportsStreaming: true,
    costPer1kInput: 0.005,
    costPer1kOutput: 0.015,
  },
  'gpt-4o-mini': {
    id: 'gpt-4o-mini',
    provider: 'openai',
    displayName: 'GPT-4o Mini',
    contextWindow: 128000,
    maxOutput: 16384,
    supportsVision: true,
    supportsToolUse: true,
    supportsStreaming: true,
    costPer1kInput: 0.00015,
    costPer1kOutput: 0.0006,
  },
  'deepseek-v4-flash': {
    id: 'deepseek-v4-flash',
    provider: 'deepseek',
    displayName: 'DeepSeek V4 Flash',
    contextWindow: 128000,
    maxOutput: 16384,
    supportsVision: false,
    supportsToolUse: true,
    supportsStreaming: true,
    costPer1kInput: 0.0001,
    costPer1kOutput: 0.0002,
  },
  'deepseek-chat': {
    id: 'deepseek-chat',
    provider: 'deepseek',
    displayName: 'DeepSeek Chat',
    contextWindow: 128000,
    maxOutput: 8192,
    supportsVision: false,
    supportsToolUse: true,
    supportsStreaming: true,
    costPer1kInput: 0.0001,
    costPer1kOutput: 0.0002,
  },
  'deepseek-coder': {
    id: 'deepseek-coder',
    provider: 'deepseek',
    displayName: 'DeepSeek Coder',
    contextWindow: 128000,
    maxOutput: 8192,
    supportsVision: false,
    supportsToolUse: true,
    supportsStreaming: true,
    costPer1kInput: 0.0001,
    costPer1kOutput: 0.0002,
  },
  'MiniMax-M3': {
    id: 'MiniMax-M3',
    provider: 'MiniMax',
    displayName: 'MiniMax M3',
    contextWindow: 128000,
    maxOutput: 16384,
    supportsVision: false,
    supportsToolUse: true,
    supportsStreaming: true,
    costPer1kInput: 0.001,
    costPer1kOutput: 0.008,
  },
  'MiniMax-M3[1M]': {
    id: 'MiniMax-M3[1M]',
    provider: 'MiniMax',
    displayName: 'MiniMax M3 (1M)',
    contextWindow: 1000000,
    maxOutput: 16384,
    supportsVision: false,
    supportsToolUse: true,
    supportsStreaming: true,
    costPer1kInput: 0.002,
    costPer1kOutput: 0.016,
  },
  'MiniMax-M2.7-highspeed': {
    id: 'MiniMax-M2.7-highspeed',
    provider: 'MiniMax',
    displayName: 'MiniMax M2.7 HighSpeed',
    contextWindow: 128000,
    maxOutput: 8192,
    supportsVision: false,
    supportsToolUse: true,
    supportsStreaming: true,
    costPer1kInput: 0.0005,
    costPer1kOutput: 0.004,
  },
}

export function getModelConfig(modelId: string): ModelConfig | undefined {
  return MODEL_CATALOG[modelId]
}

export function listModels(provider?: string): ModelConfig[] {
  const models = Object.values(MODEL_CATALOG)
  if (provider) return models.filter(m => m.provider === provider)
  return models
}

export function supportsFeature(modelId: string, feature: keyof Pick<ModelConfig, 'supportsVision' | 'supportsToolUse' | 'supportsStreaming'>): boolean {
  const config = MODEL_CATALOG[modelId]
  return config ? config[feature] : false
}

export function listModelsByProvider(provider: string): string[] {
  return listModels(provider).map(m => m.id)
}

export const PROVIDER_PRIORITY: string[] = ['anthropic', 'openai', 'deepseek', 'MiniMax']
