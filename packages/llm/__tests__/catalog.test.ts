import { describe, it, expect } from 'vitest'
import { listModelsByProvider, getModelConfig, MODEL_CATALOG, listModels, supportsFeature } from '../catalog'

describe('catalog', () => {
  describe('listModelsByProvider', () => {
    it('should return models for anthropic provider', () => {
      const models = listModelsByProvider('anthropic')
      
      expect(models.length).toBeGreaterThan(0)
      expect(models.every(id => MODEL_CATALOG[id]?.provider === 'anthropic')).toBe(true)
    })

    it('should return models for openai provider', () => {
      const models = listModelsByProvider('openai')
      
      expect(models.length).toBeGreaterThan(0)
      expect(models.every(id => MODEL_CATALOG[id]?.provider === 'openai')).toBe(true)
    })

    it('should return empty array for non-existent provider', () => {
      const models = listModelsByProvider('nonexistent')
      
      expect(models.length).toBe(0)
    })

    it('should return all models when provider is empty', () => {
      const models = listModelsByProvider('')
      
      expect(models.length).toBe(Object.keys(MODEL_CATALOG).length)
    })
  })

  describe('getModelConfig', () => {
    it('should return config for existing model', () => {
      const config = getModelConfig('claude-sonnet-4-20250514')
      
      expect(config).toBeDefined()
      expect(config?.id).toBe('claude-sonnet-4-20250514')
      expect(config?.provider).toBe('anthropic')
      expect(config?.displayName).toBe('Claude Sonnet 4')
    })

    it('should return undefined for non-existent model', () => {
      const config = getModelConfig('non-existent-model')
      
      expect(config).toBeUndefined()
    })

    it('should have required fields', () => {
      const config = getModelConfig('gpt-4o')
      
      expect(config).toBeDefined()
      expect(config?.contextWindow).toBeGreaterThan(0)
      expect(config?.maxOutput).toBeGreaterThan(0)
      expect(typeof config?.supportsVision).toBe('boolean')
      expect(typeof config?.supportsToolUse).toBe('boolean')
      expect(typeof config?.supportsStreaming).toBe('boolean')
      expect(config?.costPer1kInput).toBeGreaterThanOrEqual(0)
      expect(config?.costPer1kOutput).toBeGreaterThanOrEqual(0)
    })
  })

  describe('listModels', () => {
    it('should return all models when no provider specified', () => {
      const models = listModels()
      
      expect(models.length).toBe(Object.keys(MODEL_CATALOG).length)
    })

    it('should filter by provider when specified', () => {
      const models = listModels('deepseek')
      
      expect(models.length).toBeGreaterThan(0)
      expect(models.every(m => m.provider === 'deepseek')).toBe(true)
    })
  })

  describe('supportsFeature', () => {
    it('should return true for supported features', () => {
      expect(supportsFeature('claude-sonnet-4-20250514', 'supportsVision')).toBe(true)
      expect(supportsFeature('gpt-4o', 'supportsToolUse')).toBe(true)
      expect(supportsFeature('deepseek-v4-flash', 'supportsStreaming')).toBe(true)
    })

    it('should return false for unsupported features', () => {
      expect(supportsFeature('deepseek-v4-flash', 'supportsVision')).toBe(false)
    })

    it('should return false for non-existent model', () => {
      expect(supportsFeature('non-existent', 'supportsVision')).toBe(false)
    })
  })
})