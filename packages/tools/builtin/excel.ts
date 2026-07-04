import { existsSync } from 'node:fs'
import { z } from 'zod'
import type { ToolRegistry } from '../registry'

function registerExcelRead(registry: ToolRegistry): void {
  registry.register({
    name: 'excel_read',
    description: '读取 Excel 文件内容。支持 .xlsx/.xls/.csv。可指定 sheet 名称和行范围。',
    inputSchema: z.object({
      path: z.string().describe('Excel 文件路径'),
      sheet: z.string().optional().describe('Sheet 名称（默认第一个）'),
      range: z.string().optional().describe('行范围，如 "A1:D10" 或 "1-50"（第1到50行）'),
      format: z.enum(['json', 'csv', 'markdown']).default('markdown').describe('输出格式'),
    }),
    handler: async ({ path, sheet, range, format }: { path: string; sheet?: string; range?: string; format: 'json' | 'csv' | 'markdown' }) => {
      try {
        const XLSX = await import('xlsx')
        const wb = XLSX.readFile(path)
        const sheetName = sheet || wb.SheetNames[0]
        if (!sheetName) return { success: false, error: '文件中没有 sheet' }
        const ws = wb.Sheets[sheetName]
        let data: any[][]
        if (range) {
          const rangeMatch = range.match(/^(\d+)-(\d+)$/)
          if (rangeMatch) {
            const start = parseInt(rangeMatch[1], 10) - 1
            const end = parseInt(rangeMatch[2], 10)
            const all = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' })
            data = all.slice(start, end)
          } else {
            data = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '', range })
          }
        } else {
          data = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '' })
        }
        if (data.length === 0) return { success: true, output: '(空 sheet)' }
        if (format === 'json') return { success: true, output: JSON.stringify(data, null, 2) }
        if (format === 'csv') {
          const csv = data.map(row => row.map(String).join(',')).join('\n')
          return { success: true, output: csv }
        }
        const header = data[0].map(String)
        const rows = data.slice(1)
        const colWidths = header.map((h, i) => {
          const maxLen = Math.max(h.length, ...rows.map(r => String(r[i] ?? '').length))
          return Math.min(maxLen, 40)
        })
        const pad = (s: string, w: number) => s.slice(0, w).padEnd(w)
        const lines: string[] = []
        lines.push(`| ${header.map((h, i) => pad(h, colWidths[i])).join(' | ')} |`)
        lines.push(`| ${colWidths.map(w => '-'.repeat(w)).join(' | ')} |`)
        for (const row of rows) {
          lines.push(`| ${header.map((_, i) => pad(String(row[i] ?? ''), colWidths[i])).join(' | ')} |`)
        }
        return { success: true, output: lines.join('\n') }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    },
  })
}

function registerExcelWrite(registry: ToolRegistry): void {
  registry.register({
    name: 'excel_write',
    description: '写入数据到 Excel 文件。支持新建或追加到已有文件。',
    inputSchema: z.object({
      path: z.string().describe('输出文件路径 (.xlsx/.csv)'),
      sheet: z.string().optional().describe('Sheet 名称（默认 Sheet1）'),
      data: z.array(z.array(z.any())).describe('二维数组数据，第一行为表头'),
      append: z.boolean().optional().describe('是否追加到已有文件（默认覆盖）'),
    }),
    handler: async ({ path, sheet, data, append }: { path: string; sheet?: string; data: any[][]; append?: boolean }) => {
      try {
        const XLSX = await import('xlsx')
        let wb: any
        if (append && existsSync(path)) {
          wb = XLSX.readFile(path)
        } else {
          wb = XLSX.utils.book_new()
        }
        const ws = XLSX.utils.aoa_to_sheet(data)
        const sheetName = sheet || 'Sheet1'
        if (wb.SheetNames.includes(sheetName)) {
          const idx = wb.SheetNames.indexOf(sheetName)
          wb.SheetNames[idx] = sheetName
          wb.Sheets[sheetName] = ws
        } else {
          XLSX.utils.book_append_sheet(wb, ws, sheetName)
        }
        XLSX.writeFile(wb, path)
        return { success: true, output: `已写入 ${data.length} 行数据到 ${path}` }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    },
  })
}

export function registerExcelTools(registry: ToolRegistry): void {
  registerExcelRead(registry)
  registerExcelWrite(registry)
}
