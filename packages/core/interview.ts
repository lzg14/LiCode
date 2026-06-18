import { LoopContext } from './loop'

/**
 * Interview 追问机制
 * 基于 grill-me skill：一次只问一个问题，顺着设计树走
 */

interface InterviewQuestion {
  question: string
  recommendation?: string
  reason: string
  branch?: string
}

/**
 * 检查是否需要 Interview
 */
export function needsInterview(ctx: LoopContext): boolean {
  const { effortLevel } = ctx
  // E3+ 需要确认，E4+ 强制 Interview
  return effortLevel >= 3
}

/**
 * 生成 Interview 问题
 * 基于用户输入和已识别的风险，生成追问问题
 */
export function generateInterviewQuestions(ctx: LoopContext): InterviewQuestion[] {
  const { userInput, risks = [], effortLevel } = ctx
  const questions: InterviewQuestion[] = []

  // 检查需求是否清晰
  if (isVagueRequest(userInput)) {
    questions.push({
      question: '你提到的这个需求，具体想实现什么功能？',
      recommendation: '请用一句话描述核心功能',
      reason: '需求模糊，需要明确目标',
      branch: '功能定义',
    })
  }

  // 检查影响范围
  if (hasUnclearScope(userInput)) {
    questions.push({
      question: '这个改动会影响哪些文件/模块？',
      recommendation: '列出受影响的文件或模块',
      reason: '影响范围不明确',
      branch: '影响范围',
    })
  }

  // 根据风险生成追问
  if (risks.length > 0) {
    questions.push({
      question: `识别到 ${risks.length} 个风险：${risks.join('、')}。这些风险你了解吗？`,
      recommendation: '确认已了解风险',
      reason: '风险需要用户确认',
      branch: '风险确认',
    })
  }

  // E4+ 需要更多追问
  if (effortLevel >= 4) {
    questions.push({
      question: '有没有现成的类似实现可以参考？',
      recommendation: '搜索 GitHub/NPM 等平台',
      reason: '避免重复造轮子',
      branch: '外部知识',
    })
  }

  return questions
}

/**
 * 生成 Anti-criteria 反向追问
 */
export function generateAntiCriteria(ctx: LoopContext): string[] {
  const { userInput, effortLevel } = ctx
  const antiCriteria: string[] = []

  // E4+ 强制展示弊端
  if (effortLevel >= 4) {
    antiCriteria.push(
      '性能影响：这个改动会增加多少复杂度？',
      '维护成本：后续维护难度会增加吗？',
      '耦合风险：会引入新的依赖吗？',
    )
  }

  // E5 需要更多弊端
  if (effortLevel >= 5) {
    antiCriteria.push(
      '安全风险：有什么潜在的安全问题？',
      '迁移成本：现有数据/代码需要迁移吗？',
      '失败模式：如果失败了会怎样？',
    )
  }

  // 根据输入内容添加特定弊端
  if (userInput.includes('缓存')) {
    antiCriteria.push('缓存一致性：数据更新后缓存如何失效？')
  }
  if (userInput.includes('删除')) {
    antiCriteria.push('数据恢复：删除后能否恢复？')
  }
  if (userInput.includes('依赖') || userInput.includes('包')) {
    antiCriteria.push('供应链风险：依赖项是否可信？')
  }

  return antiCriteria
}

/**
 * 检查是否为模糊请求
 */
function isVagueRequest(input: string): boolean {
  const vaguePatterns = [
    /帮我(搞|弄|做|写)/,
    /实现一个/,
    /开发一个/,
    /创建一个/,
  ]
  return vaguePatterns.some(p => p.test(input)) && input.length < 50
}

/**
 * 检查是否有不明确的范围
 */
function hasUnclearScope(input: string): boolean {
  const scopeKeywords = ['系统', '架构', '重构', '迁移', '升级']
  return scopeKeywords.some(k => input.includes(k))
}

/**
 * Interview 状态管理
 */
export interface InterviewState {
  isActive: boolean
  currentQuestion: number
  questions: InterviewQuestion[]
  answers: Map<number, string>
  branches: Set<string>
}

export function createInterviewState(ctx: LoopContext): InterviewState {
  return {
    isActive: true,
    currentQuestion: 0,
    questions: generateInterviewQuestions(ctx),
    answers: new Map(),
    branches: new Set(),
  }
}

export function advanceInterview(state: InterviewState, answer: string): InterviewState {
  const newState = { ...state }
  newState.answers.set(state.currentQuestion, answer)
  newState.currentQuestion++
  if (newState.currentQuestion >= newState.questions.length) {
    newState.isActive = false
  }
  return newState
}
