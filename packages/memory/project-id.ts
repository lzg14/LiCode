/**
 * 公共 projectId 生成器
 * 
 * 使用完整路径的 SHA-256 哈希前 16 位，避免前缀碰撞问题。
 * 
 * 旧实现（有碰撞问题）：
 *   Buffer.from(path).toString('base64').slice(0, 16)
 *   只编码路径前 12 字节，同前缀项目会碰撞
 * 
 * 新实现：
 *   sha256(完整路径).slice(0, 16)
 *   碰撞概率可忽略（2^64 空间）
 */

import { createHash } from 'node:crypto'

/**
 * 根据项目路径生成唯一的 projectId
 * @param projectPath 项目绝对路径
 * @returns 16 字符的十六进制哈希字符串
 */
export function projectId(projectPath: string): string {
  return createHash('sha256').update(projectPath).digest('hex').slice(0, 16)
}
