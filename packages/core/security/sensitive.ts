/**
 * 敏感目录检查工具
 */

const SENSITIVE_PATTERNS = [
  /node_modules/,
  /\.git\//,
  /dist/,
  /build/,
  /\.idea\//,
  /\.vscode\//,
  /__pycache__/,
  /\.DS_Store/,
  /thumbs\.db/,
  /\.env/,
  /\.env\.\w+/,
  /credentials\.json/,
  /secrets\.ya?ml/,
  /password/,
  /\.pem$/,
  /\.key$/,
]

export interface SensitiveCheckResult {
  hasWarning: boolean
  issues: string[]
}

export function checkSensitivePath(cwd: string): SensitiveCheckResult {
  const issues: string[] = []

  // 检查路径中是否包含敏感目录
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(cwd)) {
      issues.push(`路径包含敏感模式: ${pattern.source}`)
    }
  }

  return {
    hasWarning: issues.length > 0,
    issues,
  }
}