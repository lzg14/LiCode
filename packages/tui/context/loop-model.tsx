/**
 * loop-model.tsx - 模型状态管理
 * 
 * 从 loop.tsx 抽取：
 * - currentModel: 当前模型
 * - currentProvider: 当前 provider
 * - effectiveContextWindow: 上下文窗口大小
 * - switchModel / switchProvider / getAvailableModels / getAvailableProviders
 */

import { createSignal } from "solid-js"
import { listModelsByProvider } from "../../llm/catalog"
import { createModel } from "../../llm/provider"

export interface ModelState {
  /** 当前模型 ID */
  currentModel: string
  /** 当前 provider */
  currentProvider: string
  /** 模型的上下文窗口大小 */
  effectiveContextWindow: number | undefined
}

export function createModelState(initialProvider: string, initialModel: string) {
  const [currentModel, setCurrentModel] = createSignal(initialModel)
  const [currentProvider, setCurrentProvider] = createSignal(initialProvider)
  const [effectiveContextWindow, setEffectiveContextWindow] = createSignal<number | undefined>(undefined)

  const switchModel = async (modelId: string, provider?: string) => {
    const targetProvider = provider ?? currentProvider()
    try {
      const { contextWindow } = await createModel({
        provider: targetProvider as any,
        model: modelId,
      })
      setCurrentModel(modelId)
      setCurrentProvider(targetProvider)
      setEffectiveContextWindow(contextWindow)
    } catch (e) {
      console.error('[Model] Switch failed:', e)
    }
  }

  const switchProvider = async (providerId: string) => {
    setCurrentProvider(providerId)
    // 切换 provider 时可能需要更新模型
    const models = listModelsByProvider(providerId as any)
    if (models.length > 0 && !models.find(m => m === currentModel())) {
      await switchModel(models[0], providerId)
    }
  }

  const getAvailableModels = (): string[] => {
    return listModelsByProvider(currentProvider() as any)
  }

  const getAvailableProviders = (): string[] => {
    return ["anthropic", "openai", "deepseek", "minimax"]
  }

  return {
    currentModel,
    currentProvider,
    effectiveContextWindow,
    setEffectiveContextWindow,
    switchModel,
    switchProvider,
    getAvailableModels,
    getAvailableProviders,
  }
}

export type ModelStateReturn = ReturnType<typeof createModelState>
