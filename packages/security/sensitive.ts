const SENSITIVE_PATHS = [
  '~',
  '/home',
  '/Users',
  '/etc',
  'C:\\Users',
  '/.ssh',
  '/.aws',
  '/.config',
]

export interface SensitiveWarning {
  path: string
  reason: string
}

export function checkSensitivePath(cwd: string): SensitiveWarning | null {
  for (const sensitive of SENSITIVE_PATHS) {
    if (cwd.includes(sensitive)) {
      return {
        path: cwd,
        reason: '包含敏感目录，可能泄露用户隐私信息',
      }
    }
  }
  return null
}
