/**
 * SIGINT 安装/卸载工具
 *
 * 旧实现：process.removeAllListeners('SIGINT') 一次性清空所有 SIGINT handler，
 * 再恢复自己认定的"原始"集合。问题：
 * 1. removeAllListeners 会移除其他模块注册的 handler（bun runtime、调试器、子模块）
 * 2. 在 remove 和新 handler 注册之间的极小时间窗内有 SIGINT 会丢失
 * 3. 后续其他模块再 on('SIGINT') 时被吞
 *
 * 新实现：只追加一个 handler，返回 dispose 函数用于卸载自己注册的那一个。
 * 这样既不破坏其他模块的 handler，又能在组件卸载时清理。
 */

/**
 * 安装一个 SIGINT handler：触发时调用 abort()。
 * 返回 dispose 函数，调用时移除本次安装的 handler（不碰其他 handler）。
 *
 * 注意：handler 是 named function（不是箭头函数），否则 removeListener 无法匹配。
 */
export function installSigintAbort(abort: () => void): () => void {
  function handler(): void {
    abort()
  }
  process.on('SIGINT', handler)
  return () => {
    process.removeListener('SIGINT', handler)
  }
}