import { access } from 'node:fs/promises'

/** 异步版 existsSync：检查路径是否可访问 */
export async function exists(path: string): Promise<boolean> {
  try { await access(path); return true } catch { return false }
}
