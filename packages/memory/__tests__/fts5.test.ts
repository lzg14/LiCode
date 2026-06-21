import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FTS5Search } from '../fts5'
import { existsSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('FTS5Search', () => {
  let dbPath: string
  let fts: FTS5Search

  beforeEach(() => {
    dbPath = join(tmpdir(), `test-fts5-${Date.now()}.db`)
    fts = new FTS5Search(dbPath)
  })

  afterEach(() => {
    fts.close()
    if (existsSync(dbPath)) {
      rmSync(dbPath)
    }
    // 清理 WAL 和 SHM 文件
    if (existsSync(dbPath + '-wal')) {
      rmSync(dbPath + '-wal')
    }
    if (existsSync(dbPath + '-shm')) {
      rmSync(dbPath + '-shm')
    }
  })

  describe('search', () => {
    it('should return results for matching query', () => {
      fts.index('1', 'Hello world this is a test')
      fts.index('2', 'Another test entry')
      fts.index('3', 'Different content')
      
      const results = fts.search('test')
      
      expect(results.length).toBe(2)
      expect(results.some(r => r.content.includes('test'))).toBe(true)
    })

    it('should return empty for non-matching query', () => {
      fts.index('1', 'Hello world')
      
      const results = fts.search('nonexistent')
      
      expect(results.length).toBe(0)
    })

    it('should return empty for empty query', () => {
      fts.index('1', 'Hello world')
      
      const results = fts.search('')
      
      expect(results.length).toBe(0)
    })

    it('should respect limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        fts.index(String(i), `Test entry ${i}`)
      }
      
      const results = fts.search('Test', 3)
      
      expect(results.length).toBeLessThanOrEqual(3)
    })

    it('should return results with scores', () => {
      fts.index('1', 'Test entry one')
      fts.index('2', 'Test entry two')
      
      const results = fts.search('Test')
      
      expect(results.length).toBe(2)
      expect(results[0].score).toBeGreaterThanOrEqual(0)
      expect(results[0].score).toBeLessThanOrEqual(1.0000001)
    })
  })

  describe('index', () => {
    it('should index new content', () => {
      fts.index('1', 'New content')
      
      const results = fts.search('New')
      
      expect(results.length).toBe(1)
      expect(results[0].id).toBe('1')
    })

    it('should update existing content', () => {
      fts.index('1', 'Original content')
      fts.index('1', 'Updated content')
      
      const results = fts.search('Updated')
      
      expect(results.length).toBe(1)
      expect(results[0].content).toBe('Updated content')
    })
  })

  describe('remove', () => {
    it('should remove indexed content', () => {
      fts.index('1', 'Content to remove')
      fts.remove('1')
      
      const results = fts.search('remove')
      
      expect(results.length).toBe(0)
    })
  })

  describe('count', () => {
    it('should return correct count', () => {
      expect(fts.count()).toBe(0)
      
      fts.index('1', 'First')
      expect(fts.count()).toBe(1)
      
      fts.index('2', 'Second')
      expect(fts.count()).toBe(2)
      
      fts.remove('1')
      expect(fts.count()).toBe(1)
    })
  })
})