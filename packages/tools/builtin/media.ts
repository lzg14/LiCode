import { exec, execFile } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { resolve, extname } from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import { IMAGE_EXTS } from './shared'
import type { ToolRegistry } from '../registry'

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

function registerReadImage(registry: ToolRegistry): void {
  registry.register({
    name: 'read_image',
    description: '读取图片文件并返回 base64 数据（供视觉模型分析）。支持 PNG/JPG/GIF/WebP/BMP/SVG。',
    inputSchema: z.object({
      path: z.string().describe('图片文件路径'),
    }),
    handler: async ({ path }: { path: string }) => {
      try {
        const absPath = resolve(path)
        if (!existsSync(absPath)) return { success: false, error: `文件不存在: ${absPath}` }
        const ext = extname(absPath).toLowerCase()
        if (!IMAGE_EXTS.has(ext)) return { success: false, error: `不支持的图片格式: ${ext}。支持: ${[...IMAGE_EXTS].join(', ')}` }
        const buffer = readFileSync(absPath)
        const mime = ext === '.svg' ? 'image/svg+xml' : `image/${ext.slice(1) === 'jpg' ? 'jpeg' : ext.slice(1)}`
        const base64 = buffer.toString('base64')
        return { success: true, output: `[图片已读取: ${absPath} (${(buffer.length / 1024).toFixed(1)} KB, ${mime})]`, imageData: { base64, mimeType: mime } }
      } catch (e) {
        return { success: false, error: String(e) }
      }
    },
  })
}

export function registerMediaTools(registry: ToolRegistry): void {
  registerReadImage(registry)
}

/**
 * 从系统剪贴板读取图片（Windows/macOS/Linux）
 * 返回 { data: base64, mime: string } 或 undefined
 */
export async function readClipboardImage(): Promise<{ data: string; mime: string } | undefined> {
  const platform = process.platform

  if (platform === 'win32') {
    const script = `Add-Type -AssemblyName System.Windows.Forms; $img = [System.Windows.Forms.Clipboard]::GetImage(); if ($img) { $ms = New-Object System.IO.MemoryStream; $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); [System.Convert]::ToBase64String($ms.ToArray()) }`
    try {
        const { stdout } = await execAsync(
          `powershell.exe -NonInteractive -NoProfile -command "${script}"`,
          { timeout: 5000, maxBuffer: 10 * 1024 * 1024 }
        )
        const trimmed = stdout.trim()
        if (trimmed && trimmed.length > 0) {
          return { data: trimmed, mime: 'image/png' }
        }
      } catch { /* 剪贴板可能不是图片 */ }
  }

  if (platform === 'darwin') {
    const tmpfile = join((await import('node:os')).tmpdir(), 'licode-clipboard.png')
    try {
      await execAsync(
        `osascript -e 'set imageData to the clipboard as "PNGf"' -e 'set fileRef to open for access POSIX file "${tmpfile}" with write permission' -e 'set eof fileRef to 0' -e 'write imageData to fileRef' -e 'close access fileRef'`,
        { timeout: 5000 }
      )
      const buffer = readFileSync(tmpfile)
      return { data: buffer.toString('base64'), mime: 'image/png' }
    } catch { /* macOS 剪贴板无图片 */ } finally {
      try { unlinkSync(tmpfile) } catch { /* 临时文件清理 */ }
    }
  }

  if (platform === 'linux') {
    try {
      const { stdout } = await execFileAsync('xclip', ['-selection', 'clipboard', '-t', 'image/png', '-o'], { timeout: 5000 })
      if (stdout.length > 0) {
        return { data: Buffer.from(stdout).toString('base64'), mime: 'image/png' }
      }
    } catch { /* xclip 可能未安装或剪贴板无图片 */ }
  }

  return undefined
}

/**
 * 读取图片文件并返回 base64（供 loop.tsx 使用）
 */
export function readImageFile(filePath: string): { base64: string; mimeType: string } | undefined {
  try {
    const absPath = resolve(filePath)
    if (!existsSync(absPath)) return undefined
    const ext = extname(absPath).toLowerCase()
    if (!IMAGE_EXTS.has(ext)) return undefined
    const buffer = readFileSync(absPath)
    const mime = ext === '.svg' ? 'image/svg+xml' : `image/${ext.slice(1) === 'jpg' ? 'jpeg' : ext.slice(1)}`
    return { base64: buffer.toString('base64'), mimeType: mime }
  } catch {
    return undefined
  }
}
