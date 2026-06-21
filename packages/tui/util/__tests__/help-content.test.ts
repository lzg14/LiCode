import { describe, it, expect } from 'vitest'
import { HELP_CONTENT } from '../help-content'

describe('HELP_CONTENT', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(HELP_CONTENT)).toBe(true)
    expect(HELP_CONTENT.length).toBeGreaterThan(0)
  })

  it('each section has title and entries', () => {
    for (const section of HELP_CONTENT) {
      expect(section.title).toBeTruthy()
      expect(Array.isArray(section.entries)).toBe(true)
      expect(section.entries.length).toBeGreaterThan(0)
    }
  })

  it('each entry has keys and desc', () => {
    for (const section of HELP_CONTENT) {
      for (const entry of section.entries) {
        expect(entry.keys).toBeTruthy()
        expect(entry.desc).toBeTruthy()
      }
    }
  })

  it('has expected sections', () => {
    const titles = HELP_CONTENT.map(s => s.title)
    expect(titles).toContain('光标移动')
    expect(titles).toContain('选择')
    expect(titles).toContain('删除')
    expect(titles).toContain('复制粘贴')
    expect(titles).toContain('其他')
  })
})
