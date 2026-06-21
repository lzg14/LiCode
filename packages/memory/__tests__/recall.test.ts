import { describe, it, expect } from 'vitest'
import { createRecallReminder, shouldTriggerRecall } from '../recall'

describe('recall', () => {
  describe('createRecallReminder', () => {
    it('should create reminder with memory path', () => {
      const memoryPath = '/path/to/memory'
      const reminder = createRecallReminder(memoryPath)
      
      expect(reminder).toContain(memoryPath)
      expect(reminder).toContain('system-reminder')
      expect(reminder).toContain('memory.search')
    })

    it('should contain proper format', () => {
      const reminder = createRecallReminder('/test/path')
      
      expect(reminder).toMatch(/<system-reminder>[\s\S]*<\/system-reminder>/)
    })
  })

  describe('shouldTriggerRecall', () => {
    it('should return true when session has memory', () => {
      const result = shouldTriggerRecall(true)
      expect(result).toBe(true)
    })

    it('should return false when session has no memory', () => {
      const result = shouldTriggerRecall(false)
      expect(result).toBe(false)
    })
  })
})