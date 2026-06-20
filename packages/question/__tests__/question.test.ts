import { describe, it, expect } from 'vitest'
import { QuestionManager, createQuestion, createQuestions } from '../index'

describe('QuestionManager', () => {
  it('should ask with handler', async () => {
    const manager = new QuestionManager()
    manager.setHandler(async (request) => ({
      id: request.id,
      answers: request.questions.map(q => ({
        selected: [q.options[0]?.label ?? ''],
      })),
    }))

    const answers = await manager.ask([{
      id: 'q1',
      question: 'Choose a color',
      header: 'Color',
      options: [{ label: 'red' }, { label: 'blue' }],
    }])

    expect(answers[0].selected).toEqual(['red'])
  })

  it('should ask with options helper', async () => {
    const manager = new QuestionManager()
    manager.setHandler(async (request) => ({
      id: request.id,
      answers: [{ selected: ['blue'] }],
    }))

    const result = await manager.askWithOptions('Pick one', ['red', 'blue'])
    expect(result).toEqual(['blue'])
  })

  it('should confirm', async () => {
    const manager = new QuestionManager()
    manager.setHandler(async () => ({
      id: 'q1',
      answers: [{ selected: ['是'] }],
    }))

    const result = await manager.confirm('Continue?')
    expect(result).toBe(true)
  })

  it('should select', async () => {
    const manager = new QuestionManager()
    manager.setHandler(async () => ({
      id: 'q1',
      answers: [{ selected: ['option-b'] }],
    }))

    const result = await manager.select('Pick one', [
      { label: 'option-a' },
      { label: 'option-b' },
    ])
    expect(result).toBe('option-b')
  })

  it('should multi select', async () => {
    const manager = new QuestionManager()
    manager.setHandler(async () => ({
      id: 'q1',
      answers: [{ selected: ['a', 'c'] }],
    }))

    const result = await manager.multiSelect('Pick multiple', [
      { label: 'a' },
      { label: 'b' },
      { label: 'c' },
    ])
    expect(result).toEqual(['a', 'c'])
  })

  it('should return default when no handler', async () => {
    const manager = new QuestionManager()
    const answers = await manager.ask([{
      id: 'q1',
      question: 'Test',
      header: 'Test',
      options: [{ label: 'opt1' }, { label: 'opt2' }],
    }])
    expect(answers[0].selected).toEqual(['opt1'])
  })
})

describe('createQuestion', () => {
  it('should create question from simple strings', () => {
    const q = createQuestion('What?', ['a', 'b', 'c'])
    expect(q.question).toBe('What?')
    expect(q.options).toHaveLength(3)
    expect(q.options[0].label).toBe('a')
  })

  it('should create with config', () => {
    const q = createQuestion('Pick', ['x', 'y'], { multiple: true, header: 'Choice' })
    expect(q.multiple).toBe(true)
    expect(q.header).toBe('Choice')
  })
})

describe('createQuestions', () => {
  it('should batch create questions', () => {
    const questions = createQuestions([
      { question: 'Q1', options: ['a', 'b'] },
      { question: 'Q2', options: ['x', 'y', 'z'], multiple: true },
    ])
    expect(questions).toHaveLength(2)
    expect(questions[0].options).toHaveLength(2)
    expect(questions[1].multiple).toBe(true)
  })
})
