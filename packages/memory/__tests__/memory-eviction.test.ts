import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, utimes, rm, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { Memory } from '../memory'

/**
 * 隔离 tmp 目录，避免污染用户 ~/.licode/memory
 */
async function makeTmpBase(): Promise<string> {
  const base = join(tmpdir(), `licode-memory-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  await mkdir(base, { recursive: true })
  await mkdir(join(base, 'global'), { recursive: true })
  await mkdir(join(base, 'sessions'), { recursive: true })
  return base
}

describe('Memory 内存上限与过期加载', () => {
  let base: string

  beforeEach(async () => {
    base = await makeTmpBase()
  })

  afterEach(async () => {
    await rm(base, { recursive: true, force: true })
  })

  it('加载时按文件 mtime 过滤过期 entry，过期文件不入内存', async () => {
    // 写一个"31 天前"的 .md 文件 + 一个刚写的
    const oldPath = join(base, 'global', 'mem_old.md')
    const newPath = join(base, 'global', 'mem_new.md')
    await writeFile(oldPath, 'old memory', 'utf-8')
    await writeFile(newPath, 'new memory', 'utf-8')

    // 把 old 的 mtime 改成 31 天前
    const oldTime = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000)
    await utimes(oldPath, oldTime, oldTime)

    // hardCap=1000, maxAgeMs=30 天
    const memory = new Memory(undefined, { baseDir: base, maxAgeMs: 30 * 24 * 60 * 60 * 1000, hardCap: 1000 })
    await memory.store({ scope: 'global', type: 'memory', content: 'force-init' })

    // 旧文件不应进入内存（也不应被 search 找到）
    const all = memory.list('global')
    const ids = all.map(e => e.id)
    expect(ids).not.toContain('mem_old')
    expect(ids).toContain('mem_new')

    // 文件本身保留在磁盘上（不主动删，避免数据丢失）
    const oldStat = await stat(oldPath).catch(() => null)
    expect(oldStat).not.toBeNull()
  })

  it('store 超过 hardCap 时按 updatedAt 淘汰最旧的，保留最新的', async () => {
    const memory = new Memory(undefined, { baseDir: base, hardCap: 3, maxAgeMs: 30 * 24 * 60 * 60 * 1000 })

    const ids: string[] = []
    for (let i = 0; i < 5; i++) {
      const id = await memory.store({ scope: 'global', type: 'memory', content: `entry-${i}` })
      ids.push(id)
      // 间隔 5ms 保证 updatedAt 有序
      await new Promise(r => setTimeout(r, 5))
    }

    const all = memory.list('global')
    // 内存里只剩 3 条（hardCap=3）
    expect(all.length).toBe(3)
    // 最新的 3 条（entry-4, entry-3, entry-2）应保留
    expect(all.map(e => e.content)).toContain('entry-4')
    expect(all.map(e => e.content)).toContain('entry-3')
    expect(all.map(e => e.content)).toContain('entry-2')
    // 最旧的 2 条（entry-0, entry-1）应被淘汰
    expect(all.map(e => e.content)).not.toContain('entry-0')
    expect(all.map(e => e.content)).not.toContain('entry-1')
  })

  it('重启后加载超过 hardCap 的目录，内存中只保留最新的 hardCap 条', async () => {
    // 预先写 5 个 .md 文件
    const now = Date.now()
    for (let i = 0; i < 5; i++) {
      const filePath = join(base, 'global', `mem_preexisting_${i}.md`)
      await writeFile(filePath, `preexisting-${i}`, 'utf-8')
      // mtime 依次递增，最新的 mtime 最高
      const t = new Date(now + i * 1000)
      await utimes(filePath, t, t)
    }

    // hardCap=3，期望加载后只保留最新的 3 条（mtime 最大的）
    const memory = new Memory(undefined, { baseDir: base, hardCap: 3, maxAgeMs: 365 * 24 * 60 * 60 * 1000 })
    await memory.store({ scope: 'global', type: 'memory', content: 'force-init' })

    const all = memory.list('global')
    // 内存里除了 force-init（最新）外，只有 3 条 pre-existing 中的最新 2 条
    // 总共 hardCap=3 条
    expect(all.length).toBeLessThanOrEqual(3)
    // 内容里应有最新的 'preexisting-4'
    expect(all.map(e => e.content)).toContain('preexisting-4')
    // 最旧的 'preexisting-0' 应被淘汰
    expect(all.map(e => e.content)).not.toContain('preexisting-0')
  })
})