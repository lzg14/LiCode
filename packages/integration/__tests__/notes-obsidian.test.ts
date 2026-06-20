import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('fs/promises', () => ({ readdir: vi.fn(), readFile: vi.fn(), stat: vi.fn() }))

import { readdir, readFile, stat } from 'fs/promises'
import { ObsidianIntegration } from '../notes-obsidian'

function mockDirent(name: string, isDir: boolean) {
  return { name, isDirectory: () => isDir, isFile: () => !isDir } as any
}

function mockStats() {
  return { mtime: new Date('2024-06-01'), size: 100, isDirectory: () => false, isFile: () => true } as any
}

describe('ObsidianIntegration', () => {
  let o: ObsidianIntegration

  beforeEach(() => { vi.clearAllMocks(); o = new ObsidianIntegration({ vaultPath: '/v' }) })

  it('connect 检测 .obsidian 目录', async () => {
    vi.mocked(stat).mockResolvedValue(mockStats())
    await o.connect()
    expect(o.enabled).toBe(true)
  })

  it('connect 无 .obsidian 抛出', async () => {
    vi.mocked(stat).mockResolvedValueOnce(mockStats()).mockRejectedValueOnce(new Error('ENOENT'))
    await expect(o.connect()).rejects.toThrow('Not an Obsidian vault')
  })

  it('readNote 解析 frontmatter', async () => {
    vi.mocked(readFile).mockResolvedValue('---\ntitle: My Note\ntags: [dev, test]\n---\nbody')
    vi.mocked(stat).mockResolvedValue(mockStats())
    o.enabled = true
    const note = await o.readNote('doc.md')
    expect(note.frontmatter!.title).toBe('My Note')
    expect(note.frontmatter!.tags).toEqual(['dev', 'test'])
  })

  it('readNote 解析布尔 frontmatter', async () => {
    vi.mocked(readFile).mockResolvedValue('---\npub: true\n---\nb')
    vi.mocked(stat).mockResolvedValue(mockStats())
    o.enabled = true
    expect((await o.readNote('d.md')).frontmatter!.pub).toBe(true)
  })

  it('readNote 提取 wiki 链接', async () => {
    vi.mocked(readFile).mockResolvedValue('see [[target]] and [[other|alias]]')
    vi.mocked(stat).mockResolvedValue(mockStats())
    o.enabled = true
    const note = await o.readNote('d.md')
    expect(note.links.some(l => l.type === 'wiki' && l.target === 'target')).toBe(true)
    expect(note.links.some(l => l.type === 'wiki' && l.target === 'other')).toBe(true)
  })

  it('readNote 提取 embed 链接', async () => {
    vi.mocked(readFile).mockResolvedValue('![[image.png]]')
    vi.mocked(stat).mockResolvedValue(mockStats())
    o.enabled = true
    const note = await o.readNote('d.md')
    expect(note.links.some(l => l.type === 'embed' && l.target === 'image.png')).toBe(true)
  })

  it('readNote 提取标签', async () => {
    vi.mocked(readFile).mockResolvedValue('---\ntags: [fmtag]\n---\n#c #d')
    vi.mocked(stat).mockResolvedValue(mockStats())
    o.enabled = true
    const note = await o.readNote('t.md')
    expect(note.tags).toContain('fmtag')
    expect(note.tags).toContain('c')
    expect(note.tags).toContain('d')
  })

  it('searchNotes 搜索 frontmatter', async () => {
    vi.mocked(readdir).mockResolvedValue([mockDirent('d.md', false)] as any)
    vi.mocked(readFile).mockResolvedValue('---\ntags: [secret-project]\n---\nbody')
    vi.mocked(stat).mockResolvedValue(mockStats())
    o.enabled = true
    expect(await o.searchNotes({ query: 'secret-project' })).toHaveLength(1)
    expect(await o.searchNotes({ query: 'nope' })).toHaveLength(0)
  })

  it('searchByTag 精确匹配（大小写不敏感）', async () => {
    vi.mocked(readdir).mockResolvedValue([mockDirent('d.md', false)] as any)
    vi.mocked(readFile).mockResolvedValue('---\ntags: [Exact-Tag]\n---\n#b')
    vi.mocked(stat).mockResolvedValue(mockStats())
    o.enabled = true
    expect(await o.searchByTag('exact-tag')).toHaveLength(1)
    expect(await o.searchByTag('exact')).toHaveLength(0)
  })

  it('getBacklinks 找到反向链接', async () => {
    vi.mocked(readdir).mockResolvedValue([mockDirent('a.md', false), mockDirent('b.md', false)] as any)
    vi.mocked(readFile).mockResolvedValueOnce('[[linked-note]]').mockResolvedValueOnce('# no links')
    vi.mocked(stat).mockResolvedValue(mockStats())
    o.enabled = true
    const bl = await o.getBacklinks('linked-note.md')
    expect(bl).toHaveLength(1)
    expect(bl[0].path).toBe('a.md')
  })

  it('parseFrontmatter 解析 YAML 类型', () => {
    const r = (o as any).parseFrontmatter('---\ntitle: H\ntags: [a, b]\npub: true\n---\nb')
    expect(r.frontmatter.title).toBe('H')
    expect(r.frontmatter.tags).toEqual(['a', 'b'])
    expect(r.frontmatter.pub).toBe(true)
    expect(r.body).toBe('b')
  })

  it('parseFrontmatter 无 frontmatter 返回原内容', () => {
    expect((o as any).parseFrontmatter('plain').frontmatter).toBeUndefined()
  })

  it('parseLinks 解析 wiki 和 tag', () => {
    const links = (o as any).parseLinks('[[page]] #tag')
    expect(links).toHaveLength(2)
    expect(links[0]).toEqual({ type: 'wiki', target: 'page', raw: '[[page]]' })
    expect(links[1].type).toBe('tag')
    expect(links[1].target).toBe('tag')
  })

  it('parseLinks 解析 embed', () => {
    const links = (o as any).parseLinks('![[img]]')
    expect(links).toHaveLength(1)
    expect(links[0]).toEqual({ type: 'embed', target: 'img', raw: '![[img]]' })
  })

  it('getDailyNotePath 格式化日期', () => {
    expect(o.getDailyNotePath(new Date(2024, 5, 15))).toBe('2024-06-15.md')
  })

  it('getDailyNotePath 自定义格式', () => {
    const oc = new ObsidianIntegration({ vaultPath: '/v', dailyNotesFormat: 'YYYY/MM/DD' })
    expect(oc.getDailyNotePath(new Date(2024, 0, 5))).toBe('2024/01/05.md')
    expect(oc.getDailyNotePath(new Date(2024, 11, 31))).toBe('2024/12/31.md')
  })

  it('isSupportedFile 仅 .md / .markdown', () => {
    expect((o as any).isSupportedFile('d.md')).toBe(true)
    expect((o as any).isSupportedFile('d.markdown')).toBe(true)
    expect((o as any).isSupportedFile('d.txt')).toBe(false)
  })
})
