import { existsSync } from 'fs'
import { join } from 'path'

export interface ExternalSource {
  type: 'claude-code' | 'opencode' | 'hermes'
  path: string
  exists: boolean
}

export function discoverExternalSources(home: string): ExternalSource[] {
  return [
    {
      type: 'claude-code',
      path: join(home, '.claude', 'projects'),
      exists: existsSync(join(home, '.claude', 'projects')),
    },
    {
      type: 'opencode',
      path: join(home, '.opencode'),
      exists: existsSync(join(home, '.opencode')),
    },
    {
      type: 'hermes',
      path: join(home, '.hermes'),
      exists: existsSync(join(home, '.hermes')),
    },
  ]
}
