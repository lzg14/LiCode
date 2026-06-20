import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('fs/promises', () => ({ readdir: vi.fn(), readFile: vi.fn(), stat: vi.fn() }))

import { readdir, readFile, stat } from 'fs/promises'
import { NotesIntegration } from '../notes'

function mockDirent(name: string, isDir: boolean) {
  return { name, isDirectory: () => isDir, isFile: () => !isDir } as any
}

function mockStats() {
  return { mtime: new Date('2024-06-01'), size: 100, isDirectory: () => false, isFile: () => true } as any
}

describe('NotesIntegration', () => {
  let n: NotesIntegration

  beforeEach(() => { vi.clearAllMocks(); n = new NotesIntegration({ vaultPath: '/v' }) })

  it('connect vault 存在时启用', async () => {
    vi.mocked(stat).mockResolvedValue(mockStats())
    await n.connect()
    expect(n.enabled).toBe(true)
  })

  it('connect vault 不存在时抛出', async () => {
    vi.mocked(stat).mockRejectedValue(new Error('ENOENT'))
    await expect(n.connect()).rejects.toThrow('Vault path not found')
    expect(n.enabled).toBe(false)
  })

  it('readNote 读取文件并提取 title', async () => {
    vi.mocked(readFile).mockResolvedValue('# Title\nbody')
    vi.mocked(stat).mockResolvedValue(mockStats())
    n.enabled = true
    const note = await n.readNote('doc.md')
    expect(note.title).toBe('Title')
    expect(note.content).toBe('# Title\nbody')
    expect(note.path).toBe('doc.md')
  })

  it('readNote 无 heading 使用文件名', async () => {
    vi.mocked(readFile).mockResolvedValue('plain content')
    vi.mocked(stat).mockResolvedValue(mockStats())
    n.enabled = true
    expect((await n.readNote('my-note.md')).title).toBe('my-note')
  })

  it('listNotes 递归列出并跳过隐藏文件', async () => {
    vi.mocked(readdir).mockResolvedValue([mockDirent('a.md', false), mockDirent('.h.md', false)] as any)
    vi.mocked(readFile).mockResolvedValue('# x')
    vi.mocked(stat).mockResolvedValue(mockStats())
    n.enabled = true
    const notes = await n.listNotes()
    expect(notes).toHaveLength(1)
    expect(notes[0].path).toBe('a.md')
  })

  it('listNotes 递归处理子目录', async () => {
    vi.mocked(readdir)
      .mockResolvedValueOnce([mockDirent('sub', true)] as any)
      .mockResolvedValueOnce([mockDirent('deep.md', false)] as any)
    vi.mocked(readFile).mockResolvedValue('# x')
    vi.mocked(stat).mockResolvedValue(mockStats())
    n.enabled = true
    const notes = await n.listNotes()
    expect(notes).toHaveLength(1)
    expect(notes[0].path).toBe('sub/deep.md')
  })

  it('searchNotes 按内容匹配', async () => {
    vi.mocked(readdir).mockResolvedValue([mockDirent('d.md', false)] as any)
    vi.mocked(readFile).mockResolvedValue('found keyword here')
    vi.mocked(stat).mockResolvedValue(mockStats())
    n.enabled = true
    expect(await n.searchNotes({ query: 'keyword' })).toHaveLength(1)
    expect(await n.searchNotes({ query: 'missing' })).toHaveLength(0)
  })

  it('searchNotes 大小写敏感开关', async () => {
    vi.mocked(readdir).mockResolvedValue([mockDirent('d.md', false)] as any)
    vi.mocked(readFile).mockResolvedValue('KEYWORD')
    vi.mocked(stat).mockResolvedValue(mockStats())
    n.enabled = true
    expect(await n.searchNotes({ query: 'KEYWORD', caseSensitive: true })).toHaveLength(1)
    expect(await n.searchNotes({ query: 'keyword', caseSensitive: true })).toHaveLength(0)
  })

  it('searchByTag 正则匹配', async () => {
    vi.mocked(readdir).mockResolvedValue([mockDirent('d.md', false)] as any)
    vi.mocked(readFile).mockResolvedValue('#hello #world cool')
    vi.mocked(stat).mockResolvedValue(mockStats())
    n.enabled = true
    expect(await n.searchByTag('world')).toHaveLength(1)
    expect(await n.searchByTag('foo')).toHaveLength(0)
  })

  it('getFolderStructure 构建目录树', async () => {
    vi.mocked(stat).mockResolvedValue(mockStats())
    vi.mocked(readdir).mockResolvedValue([mockDirent('a.md', false), mockDirent('sub', true)] as any)
    n.enabled = true
    const s = await n.getFolderStructure()
    expect(Array.isArray(s)).toBe(true)
  })

  it('extractTitle 从 heading 或文件名提取', () => {
    expect((n as any).extractTitle('p/n.md', '# H1\nb')).toBe('H1')
    expect((n as any).extractTitle('p/MyDoc.md', 'no head')).toBe('MyDoc')
  })

  it('isSupportedFile 校验扩展名', () => {
    expect((n as any).isSupportedFile('a.md')).toBe(true)
    expect((n as any).isSupportedFile('a.markdown')).toBe(true)
    expect((n as any).isSupportedFile('a.txt')).toBe(true)
    expect((n as any).isSupportedFile('a.ts')).toBe(false)
  })
})
