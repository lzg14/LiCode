const BASE_WHITELIST = [
  'git', 'cargo', 'npm', 'npx', 'pnpm',
  'ruff', 'mypy', 'eslint', 'prettier', 'biome', 'tsc',
  'psql', 'mysql', 'docker', 'playwright',
  'grep', 'find', 'ls', 'cat', 'head', 'tail', 'wc', 'echo', 'pwd', 'tree',
  'curl', 'wget', 'gh',
  'pip', 'uv',
  'vitest', 'prisma',
  'node', 'next',
]

const PLATFORM_WHITELIST: Record<string, string[]> = {
  win32: ['powershell', 'pwsh', 'cmd', 'where', 'tasklist'],
  darwin: ['open', 'pbcopy', 'pbpaste'],
  linux: ['xdg-open', 'xclip'],
}

export function getDefaultWhitelist(platform: NodeJS.Platform = process.platform): string[] {
  return [
    ...BASE_WHITELIST,
    ...(PLATFORM_WHITELIST[platform] ?? []),
  ]
}

// 向后兼容的 export
export const DEFAULT_WHITELIST = getDefaultWhitelist()

const BLOCKED_COMMANDS = [
  'bash', 'sh', 'zsh',
  'rm', 'del',
  'sudo', 'su',
  'chmod', 'chown',
  'python', 'python3',
  'exec', 'eval',
]

export { BLOCKED_COMMANDS }

export function isCommandAllowed(command: string): boolean {
  const trimmed = command.trim()
  if (!trimmed) return false
  const base = trimmed.split(' ')[0]
  if (BLOCKED_COMMANDS.includes(base)) return false
  return DEFAULT_WHITELIST.includes(base)
}
