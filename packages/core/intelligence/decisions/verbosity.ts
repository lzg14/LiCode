// verbosity decision: 基于 M4 user-pref 控制详细度
// v2 plan §4.M4 表格:
//   - 用户删除生成的注释 → user-pref no_comments++ → 超过 3 次 → 以后不加注释
//   - 用户手动修复类型错误 → user-pref type_fix++ → 超过 2 次 → 生成时更注意类型
//
// 规则：
//   - signal 'user_deleted_comment' count >= 3 → 提示少注释
//   - signal 'user_added_type' count >= 2 → 提示更注意类型
//   - 多信号同时触发 → 合并提示

import type { DecisionHandler } from '../types'

const NO_COMMENTS_THRESHOLD = 3
const ADD_TYPE_THRESHOLD = 2

export const verbosityDecision: DecisionHandler = (inputs) => {
  const noComments = inputs.userPref.find((p) => p.signal === 'user_deleted_comment')
  const addType = inputs.userPref.find((p) => p.signal === 'user_added_type')

  const hints: string[] = []
  const meta: Record<string, unknown> = {}

  if (noComments && noComments.count >= NO_COMMENTS_THRESHOLD) {
    hints.push(
      `- **少注释**：用户已 ${noComments.count} 次删除生成的注释。只写必要的代码注释（解释 why，不解释 what），不要主动添加解释性注释。`,
    )
    meta.noCommentsCount = noComments.count
  }

  if (addType && addType.count >= ADD_TYPE_THRESHOLD) {
    hints.push(
      `- **更注意类型**：用户已 ${addType.count} 次手动补全类型。生成代码时显式声明类型，`
      + `避免依赖 TypeScript 推断。`,
    )
    meta.addTypeCount = addType.count
  }

  if (hints.length === 0) {
    return { name: 'verbosity', triggered: false, content: '' }
  }

  return {
    name: 'verbosity',
    triggered: true,
    content: `## 详细度提示\n\n${hints.join('\n')}`,
    meta,
  }
}
