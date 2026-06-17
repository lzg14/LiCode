export interface MemoryEntry {
  id: string
  scope: 'global' | 'project' | 'session'
  type: 'memory' | 'notes' | 'checkpoint' | 'progress' | 'feedback'
  content: string
  createdAt: number
  updatedAt: number
  accessCount: number
}

export interface MemorySearchResult {
  id: string
  content: string
  score: number
}
