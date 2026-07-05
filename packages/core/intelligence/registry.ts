// DecisionRegistry — 按 name 注册/查询 decision handler
// v2 plan §4.M5: "单 adapter 无 DAG" — 用 Map 保持插入顺序

import type { DecisionHandler } from './types'

export class DecisionRegistry {
  private handlers = new Map<string, DecisionHandler>()

  /** 注册一个 decision handler（同 name 重复注册覆盖） */
  register(name: string, handler: DecisionHandler): void {
    this.handlers.set(name, handler)
  }

  /** 取消注册（用于测试或动态重载） */
  unregister(name: string): boolean {
    return this.handlers.delete(name)
  }

  /** 按 name 获取 handler */
  get(name: string): DecisionHandler | undefined {
    return this.handlers.get(name)
  }

  /** 列出所有已注册的 decision（按插入顺序） */
  list(): string[] {
    return Array.from(this.handlers.keys())
  }

  /** 数量 */
  size(): number {
    return this.handlers.size
  }

  /** 清空（用于测试） */
  clear(): void {
    this.handlers.clear()
  }
}
