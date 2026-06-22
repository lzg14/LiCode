import type { z } from 'zod'

export function formatConfigError(err: z.ZodError): string {
  return err.issues.map(issue => {
    const path = issue.path.join('.')
    switch (issue.code) {
      case 'invalid_value': {
        const values = (issue as any).values ?? []
        return `配置错误 [${path}]: 必须是以下之一: ${values.join(', ')}`
      }
      case 'invalid_type': {
        const expected = (issue as any).expected
        return `配置错误 [${path}]: 期望类型 ${expected}`
      }
      case 'invalid_format': {
        return `配置错误 [${path}]: 格式无效 — ${issue.message}`
      }
      case 'unrecognized_keys': {
        const keys = (issue as any).keys ?? []
        return `配置错误: 未知字段 ${keys.join(', ')}`
      }
      default:
        return `配置错误 [${path}]: ${issue.message}`
    }
  }).join('\n')
}
