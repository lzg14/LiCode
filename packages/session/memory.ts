import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { exists } from '../core/utils/fs'
import { memoryRoot } from './checkpoint-paths'

export interface MemoryEntry {
  path: string
  content: string
  score: number
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ')
    .split(' ')
    .filter(Boolean)
}

function termFrequency(terms: string[], doc: string): number {
  const docTerms = tokenize(doc)
  const docFreq: Record<string, number> = {}
  for (const t of docTerms) {
    docFreq[t] = (docFreq[t] || 0) + 1
  }

  let score = 0
  for (const term of terms) {
    const tf = docFreq[term] || 0
    if (tf > 0) {
      // Simplified TF: log(1 + count)
      score += Math.log(1 + tf)
    }
  }
  return score
}

async function collectFiles(dir: string, maxDepth = 3): Promise<string[]> {
  const results: string[] = []
  if (!(await exists(dir))) return results

  async function walk(current: string, depth: number): Promise<void> {
    if (depth > maxDepth) return
    const entries = await readdir(current)
    for (const entry of entries) {
      const fullPath = join(current, entry)
      try {
        const s = await stat(fullPath)
        if (s.isDirectory()) {
          await walk(fullPath, depth + 1)
        } else if (s.isFile() && ['.md', '.txt', '.json'].includes(extname(fullPath))) {
          if (!entry.startsWith('.')) {
            results.push(fullPath)
          }
        }
      } catch { /* 无权限读取该文件，跳过 */ }
    }
  }

  await walk(dir, 0)
  return results
}

export async function searchMemory(input: {
  query: string
  dataDir: string
  topK?: number
  projectID?: string
}): Promise<MemoryEntry[]> {
  const { query, dataDir, topK = 5, projectID } = input
  const root = memoryRoot(dataDir)
  if (!(await exists(root))) return []

  const searchDirs: string[] = []

  const globalDir = join(root, 'global')
  if (await exists(globalDir)) {
    searchDirs.push(globalDir)
  }

  if (projectID) {
    const projectDir = join(root, 'projects', projectID)
    if (await exists(projectDir)) {
      searchDirs.push(projectDir)
    }
  }

  const terms = tokenize(query)
  if (terms.length === 0) return []

  const scored: MemoryEntry[] = []

  for (const dir of searchDirs) {
    const files = await collectFiles(dir)
    for (const filePath of files) {
      try {
        const content = await readFile(filePath, 'utf-8')
        const score = termFrequency(terms, content)
        if (score > 0) {
          scored.push({ path: filePath, content, score })
        }
      } catch { /* 文件读取失败，跳过 */ }
    }
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, topK)
}

export async function getRecentMemoryEntries(dataDir: string, limit = 5): Promise<MemoryEntry[]> {
  const root = memoryRoot(dataDir)
  if (!(await exists(root))) return []

  const recent: { path: string; mtime: Date }[] = []

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir)
    for (const entry of entries) {
      const fullPath = join(dir, entry)
      try {
        const s = await stat(fullPath)
        if (s.isDirectory()) {
          await walk(fullPath)
        } else if (s.isFile() && extname(fullPath) === '.md') {
          recent.push({ path: fullPath, mtime: s.mtime })
        }
      } catch { /* 无权限读取该文件，跳过 */ }
    }
  }

  await walk(root)
  recent.sort((a, b) => b.mtime.getTime() - a.mtime.getTime())

  const results: MemoryEntry[] = []
  for (const r of recent.slice(0, limit)) {
    const content = await readFile(r.path, 'utf-8')
    results.push({ path: r.path, content, score: 0 })
  }
  return results
}
