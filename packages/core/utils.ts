import { z } from 'zod'

/**
 * 将 Zod schema 转换为 JSON Schema（draft-7），移除 $schema 字段
 */
export function zodToJsonSchema(schema: any): any {
  const raw: any = z.toJSONSchema(schema, { target: 'draft-7' })
  delete raw.$schema
  return raw
}
