// task-depth decision: 占位 — 等 M2 项目感知完成后接入
// v2 plan §4.M5 "Decisions" 字段：任务深度（深度探索 vs 快速回答）
//
// 当前：永远返回 triggered=false（不决策）
// 未来：当 M2 ProjectContext 提供 testRunner / framework 时，根据项目类型
//        决定是否深入探索（fastify 项目 → 先看路由；react 项目 → 先看组件树）。

import type { DecisionHandler } from '../types'

export const taskDepthDecision: DecisionHandler = (_inputs) => {
  return {
    name: 'task-depth',
    triggered: false,
    content: '',
    meta: { placeholder: true, m2Required: true },
  }
}
