import { z } from 'zod'
import type { ToolRegistry } from '../registry'

function registerWebfetch(registry: ToolRegistry): void {
  registry.register({
    name: 'webfetch',
    description: '获取网页内容。',
    inputSchema: z.object({ url: z.string().url(), format: z.enum(['markdown', 'text', 'html']).default('markdown'), timeout: z.number().optional() }),
    handler: async ({ url, format, timeout }: { url: string; format: 'markdown' | 'text' | 'html'; timeout?: number }) => {
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeout ?? 15_000)
        const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Licode/0.3.0' } })
        clearTimeout(timer)
        if (!response.ok) return { success: false, error: `HTTP ${response.status}` }
        const body = await response.text()
        if (format === 'html') {
          return { success: true, output: body.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50_000) }
        }
        return { success: true, output: body.slice(0, 50_000) }
      } catch (e) { return { success: false, error: e instanceof Error ? e.message : String(e) } }
    },
  })
}

function registerWebsearch(registry: ToolRegistry): void {
  registry.register({
    name: 'websearch',
    description: '搜索网页（cn.bing.com，国内可用）。',
    inputSchema: z.object({ query: z.string(), numResults: z.number().min(1).max(20).default(5) }),
    handler: async ({ query, numResults }: { query: string; numResults: number }) => {
      try {
        const url = `https://cn.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-CN`
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          },
        })
        if (!response.ok) return { success: false, error: `搜索失败: ${response.status}` }
        const html = await response.text()
        if (/verification|checking your browser|captcha|smartcaptcha/i.test(html)) {
          return { success: false, error: '搜索引擎返回验证页面，请稍后重试' }
        }
        const results: string[] = []
        const algoRe = /<li[^>]+class="[^"]*\bb_algo\b[^"]*"[^>]*>[\s\S]*?<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/gi
        let match = algoRe.exec(html)
        while (match !== null && results.length < numResults) {
          const rawHref = match[1]
          const title = match[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
          let href = rawHref
          const bingRedirect = href.match(/^https?:\/\/cn\.bing\.com\/link\?url=([^&]+)/)
          if (bingRedirect) {
            try { href = decodeURIComponent(bingRedirect[1]) } catch { /* URL 解码失败，使用原始 href */ }
          }
          if (title && href && /^https?:\/\//i.test(href)) {
            results.push(`[${title}](${href})`)
          }
          match = algoRe.exec(html)
        }
        if (results.length === 0) {
          const fallbackRe = /<h2[^>]*>\s*<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/gi
          let fbMatch = fallbackRe.exec(html)
          while (fbMatch !== null && results.length < numResults) {
            const title = fbMatch[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
            if (title && fbMatch[1]) results.push(`[${title}](${fbMatch[1]})`)
            fbMatch = fallbackRe.exec(html)
          }
        }
        return { success: true, output: results.join('\n') || '未找到结果' }
      } catch (e) { return { success: false, error: String(e) } }
    },
  })
}

export function registerWebTools(registry: ToolRegistry): void {
  registerWebfetch(registry)
  registerWebsearch(registry)
}
