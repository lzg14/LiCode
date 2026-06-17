export type PermissionLevel = 1 | 2 | 3 | 4 | 5

export interface Permission {
  level: PermissionLevel
  allowedPaths: string[]
  deniedPaths: string[]
  allowedCommands: string[]
}

export function checkPathPermission(path: string, permission: Permission): boolean {
  if (permission.deniedPaths.some(dp => path.startsWith(dp))) {
    return false
  }
  if (permission.allowedPaths.some(ap => path.startsWith(ap))) {
    return true
  }
  return false
}
