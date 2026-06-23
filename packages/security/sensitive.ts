const SENSITIVE_DIRS = [
  '.ssh',
  '.aws',
  '.config',
  '.gnupg',
]

export interface SensitiveWarning {
  path: string
  reason: string
}

export function checkSensitivePath(cwd: string): SensitiveWarning | null {
  const sep = cwd.includes('\\') ? '\\' : '/'
  for (const dir of SENSITIVE_DIRS) {
    if (cwd.includes(`${sep}${dir}${sep}`) || cwd.endsWith(`${sep}${dir}`)) {
      return {
        path: cwd,
        reason: '包含敏感目录，可能泄露用户隐私信息',
      }
    }
  }
  return null
}
