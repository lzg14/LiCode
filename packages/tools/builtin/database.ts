import { resolve } from 'node:path'
import { z } from 'zod'
import type { ToolRegistry } from '../registry'

function registerDatabaseQuery(registry: ToolRegistry): void {
  registry.register({
    name: 'database_query',
    description: '对 SQLite 数据库执行查询（SELECT / INSERT / UPDATE / DELETE / PRAGMA）。支持只读模式防止意外修改。',
    inputSchema: z.object({
      path: z.string().describe('数据库文件路径'),
      sql: z.string().describe('SQL 语句'),
      params: z.array(z.unknown()).optional().describe('参数化查询的参数'),
      readonly: z.boolean().default(true).describe('是否只读（默认 true 防止意外写入）'),
    }),
    handler: async ({ path, sql, params, readonly }: { path: string; sql: string; params?: any[]; readonly: boolean }) => {
      try {
        const { Database } = await import('bun:sqlite')
        const db = new Database(resolve(path), readonly ? { readonly: true } : {})
        const stmt = db.prepare(sql)
        const rows = params ? stmt.all(...params) : stmt.all()
        db.close()
        const output = JSON.stringify(rows, null, 2)
        return { success: true, output: output || '(空结果集)' }
      } catch (e) {
        return { success: false, error: `数据库查询失败: ${e instanceof Error ? e.message : String(e)}` }
      }
    },
  })
}

export function registerDatabaseTools(registry: ToolRegistry): void {
  registerDatabaseQuery(registry)
}
