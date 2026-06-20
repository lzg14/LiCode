/**
 * Question 系统 - 交互式提问
 * AI 向用户提问，等待回答
 */

import { z } from 'zod'

// ========== 类型定义 ==========

export interface QuestionOption {
  label: string
  description?: string
}

export interface Question {
  id: string
  question: string
  header: string
  options: QuestionOption[]
  multiple?: boolean
  custom?: boolean
}

export interface QuestionRequest {
  id: string
  questions: Question[]
}

export interface QuestionAnswer {
  selected: string[]
  custom?: string
}

export interface QuestionReply {
  id: string
  answers: QuestionAnswer[]
}

// ========== Schema ==========

export const QuestionOptionSchema = z.object({
  label: z.string(),
  description: z.string().optional(),
})

export const QuestionSchema = z.object({
  id: z.string(),
  question: z.string(),
  header: z.string(),
  options: z.array(QuestionOptionSchema),
  multiple: z.boolean().optional(),
  custom: z.boolean().optional(),
})

export const QuestionRequestSchema = z.object({
  id: z.string(),
  questions: z.array(QuestionSchema),
})

export const QuestionAnswerSchema = z.object({
  selected: z.array(z.string()),
  custom: z.string().optional(),
})

export const QuestionReplySchema = z.object({
  id: z.string(),
  answers: z.array(QuestionAnswerSchema),
})

// ========== QuestionManager ==========

export class QuestionManager {
  private pending = new Map<string, {
    request: QuestionRequest
    resolve: (reply: QuestionReply) => void
    reject: (error: Error) => void
  }>()

  private handler?: (request: QuestionRequest) => Promise<QuestionReply>

  /**
   * 设置回答处理器
   */
  setHandler(handler: (request: QuestionRequest) => Promise<QuestionReply>): void {
    this.handler = handler
  }

  /**
   * 创建提问请求
   */
  async ask(questions: Question[]): Promise<QuestionAnswer[]> {
    const id = `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    const request: QuestionRequest = { id, questions }

    // 如果有处理器，直接调用
    if (this.handler) {
      const reply = await this.handler(request)
      return reply.answers
    }

    // 否则返回默认答案（用于非交互模式）
    return questions.map(q => ({
      selected: [q.options[0]?.label ?? ''],
    }))
  }

  /**
   * 创建带选项的简单提问
   */
  async askWithOptions(
    question: string,
    options: string[],
    config?: { multiple?: boolean; header?: string }
  ): Promise<string[]> {
    const result = await this.ask([{
      id: 'single',
      question,
      header: config?.header ?? question.slice(0, 30),
      options: options.map(opt => ({ label: opt })),
      multiple: config?.multiple,
    }])
    return result[0]?.selected ?? []
  }

  /**
   * 创建确认提问
   */
  async confirm(question: string, defaultYes = true): Promise<boolean> {
    const result = await this.askWithOptions(
      question,
      defaultYes ? ['是', '否'] : ['否', '是'],
      { header: '确认' }
    )
    return result[0] === '是'
  }

  /**
   * 创建选择提问（单选）
   */
  async select(question: string, options: QuestionOption[]): Promise<string> {
    const result = await this.ask([{
      id: 'select',
      question,
      header: question.slice(0, 30),
      options,
    }])
    return result[0]?.selected[0] ?? ''
  }

  /**
   * 创建多选提问
   */
  async multiSelect(question: string, options: QuestionOption[]): Promise<string[]> {
    const result = await this.ask([{
      id: 'multi',
      question,
      header: question.slice(0, 30),
      options,
      multiple: true,
    }])
    return result[0]?.selected ?? []
  }

  /**
   * 处理回复
   */
  handleReply(reply: QuestionReply): void {
    const pending = this.pending.get(reply.id)
    if (pending) {
      this.pending.delete(reply.id)
      pending.resolve(reply)
    }
  }

  /**
   * 获取待处理的请求
   */
  getPending(): QuestionRequest[] {
    return Array.from(this.pending.values()).map(p => p.request)
  }

  /**
   * 取消所有待处理请求
   */
  cancelAll(): void {
    for (const [id, pending] of this.pending) {
      pending.reject(new Error('Question cancelled'))
      this.pending.delete(id)
    }
  }
}

// ========== 工具函数 ==========

/**
 * 快速创建问题
 */
export function createQuestion(
  question: string,
  options: string[],
  config?: { multiple?: boolean; header?: string }
): Question {
  return {
    id: `q_${Date.now()}`,
    question,
    header: config?.header ?? question.slice(0, 30),
    options: options.map(opt => ({ label: opt })),
    multiple: config?.multiple,
  }
}

/**
 * 批量创建问题
 */
export function createQuestions(
  items: Array<{ question: string; options: string[]; multiple?: boolean }>
): Question[] {
  return items.map((item, i) => createQuestion(item.question, item.options, { multiple: item.multiple }))
}
