/**
 * 工具输出截断工具
 * 
 * 参考 pi 的 coding-agent/utils/shell.ts
 * 统一"截断不静默"约定
 */

/** 截断结果 */
export interface TruncateResult {
  /** 截断后的文本 */
  text: string
  /** 是否被截断 */
  truncated: boolean
  /** 原始字节大小 */
  byteSize: number
  /** 原始行数 */
  lineCount: number
  /** 截断方向 */
  truncateDirection?: 'head' | 'tail' | 'line'
  /** 被截断的行数 */
  truncatedLines?: number
}

/** 截断选项 */
export interface TruncateOptions {
  /** 最大字节数（默认 20KB） */
  maxBytes?: number
  /** 最大行数（默认 5000） */
  maxLines?: number
  /** 保留头部的行数（用于 head 截断） */
  keepHeadLines?: number
  /** 保留尾部的行数（用于 tail 截断） */
  keepTailLines?: number
  /** 截断标记 */
  truncationMarker?: string
}

const DEFAULT_MAX_BYTES = 20 * 1024 // 20KB
const DEFAULT_MAX_LINES = 5000
const DEFAULT_TRUNCATION_MARKER = '\n... [truncated] ...\n'

/**
 * 从尾部截断（保留头部）
 */
export function truncateTail(
  text: string,
  options: TruncateOptions = {},
): TruncateResult {
  const {
    maxBytes = DEFAULT_MAX_BYTES,
    maxLines = DEFAULT_MAX_LINES,
    truncationMarker = DEFAULT_TRUNCATION_MARKER,
  } = options

  const byteSize = Buffer.byteLength(text, 'utf-8')
  const lineCount = text.split('\n').length

  // 检查是否需要截断
  const needsByteTruncate = byteSize > maxBytes
  const needsLineTruncate = lineCount > maxLines

  if (!needsByteTruncate && !needsLineTruncate) {
    return { text, truncated: false, byteSize, lineCount }
  }

  // 优先按行截断
  if (needsLineTruncate) {
    const lines = text.split('\n')
    const keepLines = lines.slice(0, maxLines)
    const truncatedLines = lines.length - maxLines
    return {
      text: keepLines.join('\n') + truncationMarker,
      truncated: true,
      byteSize: Buffer.byteLength(keepLines.join('\n'), 'utf-8'),
      lineCount: maxLines,
      truncateDirection: 'tail',
      truncatedLines,
    }
  }

  // 按字节截断
  if (needsByteTruncate) {
    const encoder = new TextEncoder()
    const decoder = new TextDecoder()
    const bytes = encoder.encode(text)
    const truncated = bytes.slice(0, maxBytes)
    // 确保在有效的 UTF-8 边界截断
    let truncatedText = decoder.decode(truncated)
    // 找最后一个换行符
    const lastNewline = truncatedText.lastIndexOf('\n')
    if (lastNewline > truncatedText.length * 0.9) {
      truncatedText = truncatedText.slice(0, lastNewline)
    }
    return {
      text: truncatedText + truncationMarker,
      truncated: true,
      byteSize: maxBytes,
      lineCount: truncatedText.split('\n').length,
      truncateDirection: 'tail',
    }
  }

  return { text, truncated: false, byteSize, lineCount }
}

/**
 * 从头部截断（保留尾部）
 */
export function truncateHead(
  text: string,
  options: TruncateOptions = {},
): TruncateResult {
  const {
    maxBytes = DEFAULT_MAX_BYTES,
    maxLines = DEFAULT_MAX_LINES,
    truncationMarker = DEFAULT_TRUNCATION_MARKER,
  } = options

  const byteSize = Buffer.byteLength(text, 'utf-8')
  const lineCount = text.split('\n').length

  // 检查是否需要截断
  const needsByteTruncate = byteSize > maxBytes
  const needsLineTruncate = lineCount > maxLines

  if (!needsByteTruncate && !needsLineTruncate) {
    return { text, truncated: false, byteSize, lineCount }
  }

  // 优先按行截断
  if (needsLineTruncate) {
    const lines = text.split('\n')
    const keepLines = lines.slice(-maxLines)
    const truncatedLines = lines.length - maxLines
    return {
      text: truncationMarker + keepLines.join('\n'),
      truncated: true,
      byteSize: Buffer.byteLength(keepLines.join('\n'), 'utf-8'),
      lineCount: maxLines,
      truncateDirection: 'head',
      truncatedLines,
    }
  }

  // 按字节截断
  if (needsByteTruncate) {
    const encoder = new TextEncoder()
    const decoder = new TextDecoder()
    const bytes = encoder.encode(text)
    const truncated = bytes.slice(-maxBytes)
    let truncatedText = decoder.decode(truncated)
    // 找第一个换行符
    const firstNewline = truncatedText.indexOf('\n')
    if (firstNewline < truncatedText.length * 0.1 && firstNewline > 0) {
      truncatedText = truncatedText.slice(firstNewline + 1)
    }
    return {
      text: truncationMarker + truncatedText,
      truncated: true,
      byteSize: maxBytes,
      lineCount: truncatedText.split('\n').length,
      truncateDirection: 'head',
    }
  }

  return { text, truncated: false, byteSize, lineCount }
}

/**
 * 截断单行（处理超长行）
 */
export function truncateLine(
  text: string,
  maxLineLength: number = 200,
): string {
  const lines = text.split('\n')
  const truncatedLines = lines.map(line => {
    if (line.length > maxLineLength) {
      return line.slice(0, maxLineLength) + '... [line truncated]'
    }
    return line
  })
  return truncatedLines.join('\n')
}

/**
 * 清理 ANSI 转义序列
 */
export function stripAnsi(text: string): string {
  // 匹配 ANSI 转义序列
  const ansiRegex = /[\u001B\u009B][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nq-uy=><~]/g
  return text.replace(ansiRegex, '')
}

/**
 * 清理二进制/不可打印字符
 */
export function stripBinary(text: string): string {
  // 移除空字节和控制字符（保留换行、制表符）
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
}

/**
 * 智能截断（组合使用）
 * 
 * 1. 清理 ANSI 和二进制字符
 * 2. 截断超长行
 * 3. 按总大小/行数截断
 */
export function smartTruncate(
  text: string,
  options: TruncateOptions = {},
): TruncateResult {
  // 1. 清理
  let cleaned = stripAnsi(text)
  cleaned = stripBinary(cleaned)

  // 2. 截断超长行
  cleaned = truncateLine(cleaned, options.maxLineLength ?? 200)

  // 3. 整体截断
  return truncateTail(cleaned, options)
}

/**
 * 生成截断摘要（用于显示）
 */
export function getTruncationSummary(result: TruncateResult): string | null {
  if (!result.truncated) return null

  const sizeKB = (result.byteSize / 1024).toFixed(1)
  const parts: string[] = []
  
  if (result.truncatedLines && result.truncatedLines > 0) {
    parts.push(`${result.truncatedLines} 行`)
  }
  
  if (result.truncateDirection) {
    parts.push(`从${result.truncateDirection === 'head' ? '头' : '尾'}截断`)
  }
  
  return `输出已截断 (${parts.join(', ')}，保留 ${sizeKB}KB / ${result.lineCount} 行)`
}
