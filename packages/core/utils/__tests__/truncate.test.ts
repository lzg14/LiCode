import { describe, expect, it } from 'vitest'
import {
  truncateTail,
  truncateHead,
  truncateLine,
  stripAnsi,
  stripBinary,
  smartTruncate,
  getTruncationSummary,
} from '../truncate'

describe('truncate utilities', () => {
  describe('truncateTail', () => {
    it('should not truncate short text', () => {
      const text = 'Hello, World!'
      const result = truncateTail(text)
      expect(result.truncated).toBe(false)
      expect(result.text).toBe(text)
    })

    it('should truncate by maxLines', () => {
      const lines = Array.from({ length: 100 }, (_, i) => `Line ${i}`)
      const text = lines.join('\n')
      const result = truncateTail(text, { maxLines: 10 })
      expect(result.truncated).toBe(true)
      expect(result.truncateDirection).toBe('tail')
      expect(result.text.split('\n').length).toBeLessThanOrEqual(12) // 10 lines + truncation marker (may have extra newline)
    })

    it('should truncate by maxBytes', () => {
      const text = 'A'.repeat(1000)
      const result = truncateTail(text, { maxBytes: 100 })
      expect(result.truncated).toBe(true)
      expect(Buffer.byteLength(result.text)).toBeLessThanOrEqual(150) // some margin for marker
    })

    it('should include truncation marker', () => {
      const lines = Array.from({ length: 100 }, (_, i) => `Line ${i}`)
      const text = lines.join('\n')
      const result = truncateTail(text, { maxLines: 10 })
      expect(result.text).toContain('truncated')
    })
  })

  describe('truncateHead', () => {
    it('should not truncate short text', () => {
      const text = 'Hello, World!'
      const result = truncateHead(text)
      expect(result.truncated).toBe(false)
      expect(result.text).toBe(text)
    })

    it('should truncate and keep tail', () => {
      const lines = Array.from({ length: 100 }, (_, i) => `Line ${i}`)
      const text = lines.join('\n')
      const result = truncateHead(text, { maxLines: 10 })
      expect(result.truncated).toBe(true)
      expect(result.truncateDirection).toBe('head')
      // Should contain last 10 lines
      expect(result.text).toContain('Line 99')
      expect(result.text).toContain('Line 90')
      expect(result.text).not.toContain('Line 0')
    })
  })

  describe('truncateLine', () => {
    it('should not truncate short lines', () => {
      const text = 'Short line'
      const result = truncateLine(text, 100)
      expect(result).toBe('Short line')
    })

    it('should truncate long lines', () => {
      const text = 'A'.repeat(200)
      const result = truncateLine(text, 50)
      expect(result.length).toBeLessThan(200)
      expect(result).toContain('line truncated')
    })
  })

  describe('stripAnsi', () => {
    it('should remove ANSI escape sequences', () => {
      const text = '\x1b[31mRed text\x1b[0m'
      const result = stripAnsi(text)
      expect(result).toBe('Red text')
    })

    it('should keep normal text unchanged', () => {
      const text = 'Normal text without ANSI'
      const result = stripAnsi(text)
      expect(result).toBe(text)
    })
  })

  describe('stripBinary', () => {
    it('should remove null bytes', () => {
      const text = 'Hello\x00World'
      const result = stripBinary(text)
      expect(result).toBe('HelloWorld')
    })

    it('should keep newlines and tabs', () => {
      const text = 'Line1\nLine2\tTab'
      const result = stripBinary(text)
      expect(result).toBe(text)
    })
  })

  describe('smartTruncate', () => {
    it('should clean and truncate', () => {
      // Text with ANSI and many lines
      const ansiLine = '\x1b[31mRed\x1b[0m'
      const lines = Array.from({ length: 100 }, () => ansiLine)
      const text = lines.join('\n')
      const result = smartTruncate(text, { maxLines: 10 })
      expect(result.truncated).toBe(true)
      expect(result.text).not.toContain('\x1b[')
    })
  })

  describe('getTruncationSummary', () => {
    it('should return null for non-truncated result', () => {
      const result = { text: 'Hello', truncated: false, byteSize: 5, lineCount: 1 }
      expect(getTruncationSummary(result)).toBeNull()
    })

    it('should return summary for truncated result', () => {
      const result = {
        text: 'Hello',
        truncated: true,
        byteSize: 100,
        lineCount: 10,
        truncateDirection: 'tail' as const,
        truncatedLines: 90,
      }
      const summary = getTruncationSummary(result)
      expect(summary).toContain('90 行')
      expect(summary).toContain('截断')
    })
  })
})
