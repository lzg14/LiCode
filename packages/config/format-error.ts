import type { z } from 'zod'

type ZodIssue = z.ZodIssue & { values?: unknown[]; expected?: string; keys?: unknown[] }

export function formatConfigError(err: z.ZodError): string {
  return err.issues.map((issue: ZodIssue) => {
    const path = issue.path.join('.')
    switch (issue.code) {
      case 'invalid_value': {
        const values = issue.values ?? []
        return `配置错误 [${path}]: 必须是以下之一: ${values.join(', ')}`
      }
      case 'invalid_type': {
        const expected = issue.expected
        return `配置错误 [${path}]: 期望类型 ${expected}`
      }
      case 'invalid_format': {
        return `配置错误 [${path}]: 格式无效 — ${issue.message}`
      }
      case 'unrecognized_keys': {
        const keys = issue.keys ?? []
        return `配置错误: 未知字段 ${keys.join(', ')}`
      }
      default:
        return `配置错误 [${path}]: ${issue.message}`
    }
  }).join('\n')
}
