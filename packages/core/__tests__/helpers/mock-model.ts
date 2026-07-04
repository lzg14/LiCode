import type { LanguageModel } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'

/**
 * 创建一个满足 LanguageModel 类型的 mock 模型。
 *
 * 注意：streamText 已在测试中被 vi.mock 替换，所以 MockLanguageModelV3 的
 * doStream 默认实现（throw "Not implemented"）永远不会被调用。
 * 这里只为了让 TypeScript 类型检查通过 + 保留 modelId/provider 字段供日志使用。
 */
export function makeMockLanguageModel(opts?: { modelId?: string; provider?: string }): LanguageModel {
  return new MockLanguageModelV3({
    modelId: opts?.modelId ?? 'mock-model',
    provider: opts?.provider ?? 'mock-provider',
  }) as unknown as LanguageModel
}
