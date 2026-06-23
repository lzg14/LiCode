import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join, extname } from 'path'
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

function collectFiles(dir: string, maxDepth = 3): string[] {
  const results: string[] = []
  if (!existsSync(dir)) return results

  function walk(current: string, depth: number) {
    if (depth > maxDepth) return
    const entries = readdirSync(current)
    for (const entry of entries) {
      const fullPath = join(current, entry)
      try {
        const stat = statSync(fullPath)
        if (stat.isDirectory()) {
          walk(fullPath, depth + 1)
        } else if (stat.isFile() && ['.md', '.txt', '.json'].includes(extname(fullPath))) {
          if (!entry.startsWith('.')) {
            results.push(fullPath)
          }
        }
      } catch { /* 无权限读取该文件，跳过 */ }
    }
  }

  walk(dir, 0)
  return results
}

export function searchMemory(input: {
  query: string
  dataDir: string
  topK?: number
  projectID?: string
}): MemoryEntry[] {
  const { query, dataDir, topK = 5, projectID } = input
  const root = memoryRoot(dataDir)
  if (!existsSync(root)) return []

  const searchDirs: string[] = []

  const globalDir = join(root, 'global')
  if (existsSync(globalDir)) {
    searchDirs.push(globalDir)
  }

  if (projectID) {
    const projectDir = join(root, 'projects', projectID)
    if (existsSync(projectDir)) {
      searchDirs.push(projectDir)
    }
  }

  const terms = tokenize(query)
  if (terms.length === 0) return []

  const scored: MemoryEntry[] = []

  for (const dir of searchDirs) {
    const files = collectFiles(dir)
    for (const filePath of files) {
      try {
        const content = readFileSync(filePath, 'utf-8')
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

export function getRecentMemoryEntries(dataDir: string, limit = 5): MemoryEntry[] {
  const root = memoryRoot(dataDir)
  if (!existsSync(root)) return []

  const recent: { path: string; mtime: Date }[] = []

  function walk(dir: string) {
    const entries = readdirSync(dir)
    for (const entry of entries) {
      const fullPath = join(dir, entry)
      try {
        const stat = statSync(fullPath)
        if (stat.isDirectory()) {
          walk(fullPath)
        } else if (stat.isFile() && extname(fullPath) === '.md') {
          recent.push({ path: fullPath, mtime: stat.mtime })
        }
      } catch { /* 无权限读取该文件，跳过 */ }
    }
  }

  walk(root)
  recent.sort((a, b) => b.mtime.getTime() - a.mtime.getTime())

  return recent.slice(0, limit).map(r => ({
    path: r.path,
    content: readFileSync(r.path, 'utf-8'),
    score: 0,
  }))
}
